import gzip
import json

import pytest

from app.api.openapi import OPENAPI_PATH, openapi_text
from app.jobs.manager import JobManager
from tests.api.csv_files import multipart, sample_csv
from tests.api_helpers import (
    LIGHT_HONESTY,
    assert_error,
    client,
    read_events,
    run_body,
    settings,
    wait_status,
)
from tests.jobs.children import fake_coinbase_child, stuck_child

US = json.dumps({"market": "us_equity"})


def post_form(test_client, path, fields, content):
    body, content_type = multipart(fields, content)
    return test_client.post(path, content=body, headers={"Content-Type": content_type})


def test_health_and_security_headers():
    with client() as test_client:
        response = test_client.get("/api/health")
    assert response.json() == {"status": "ok", "version": "0.1.0"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "set-cookie" not in response.headers


def test_limits_document():
    with client() as test_client:
        limits = test_client.get("/api/limits").json()
    assert limits["csv_max_bytes"] == 10 * 1024 * 1024
    assert limits["range_days"]["samples"] == {"1m": 90.0, "5m": 730.0}
    assert limits["range_days"]["coinbase"]["5m"] == 180
    assert "yahoo" not in limits["range_days"]
    assert limits["random_draws"] == {"minimum": 100, "maximum": 5000, "default": 1000}
    assert limits["retention_minutes"] == 30


def test_markets_lists_only_enabled_providers():
    with client() as test_client:
        document = test_client.get("/api/markets").json()
    ids = [provider["id"] for provider in document["providers"]]
    assert "yahoo" not in ids and "binance_archive" not in ids
    assert {"coinbase", "kraken", "samples", "user_csv"} <= set(ids)
    samples = next(p for p in document["providers"] if p["id"] == "samples")
    assert samples["mode"] == "SAMPLE DATA" and samples["attribution"]
    assert {market["id"] for market in document["markets"]} == {"us_equity", "crypto_24x7"}
    with client(enable_binance_archive=True) as test_client:
        ids = [p["id"] for p in test_client.get("/api/markets").json()["providers"]]
    assert "binance_archive" in ids


def test_strategies_endpoints():
    with client() as test_client:
        listing = test_client.get("/api/strategies").json()
        assert [s["id"] for s in listing["strategies"]][-1] == "custom"
        gap = test_client.get("/api/strategies/gap_fade").json()
        assert gap["markets"] == ["us_equity"]
        assert gap["parameters"]
        assert_error(test_client.get("/api/strategies/nope"), "not_found", 404)


def test_provider_run_on_samples_returns_a_bounded_result():
    with client() as test_client:
        created = test_client.post("/api/runs", json=run_body())
        assert created.status_code == 201
        assert created.headers["cache-control"] == "no-store"
        run_id = created.json()["run_id"]
        events = read_events(test_client, run_id)
        response = test_client.get(
            f"/api/runs/{run_id}/result", headers={"Accept-Encoding": "gzip"}
        )
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["run_id"] == run_id
    assert payload["source"]["mode"] == "SAMPLE DATA"
    assert payload["heatmap"]["mode"] == "ESTIMATED_FROM_CANDLES"
    assert payload["report"]["verdict"]["id"] == events[-1]["verdict"]
    assert len(payload["bars"]["time"]) == events[0]["bar_count"] == payload["limits"]["bars_total"]
    assert payload["limits"]["bars_truncated"] is False
    assert payload["limits"]["trades_truncated"] is False
    assert payload["request"]["data"]["symbol"] == "SAMPLE-A"
    assert payload["costs"]["fills"] == 2 * len(payload["result"]["trades"])
    assert payload["result"]["daily_equity"] and payload["result"]["assumptions"]


def test_result_truncation_is_flagged():
    with client(max_result_bars=100, max_result_trades=10) as test_client:
        body = run_body(data={**run_body()["data"], "end": "2024-06-01T00:00:00Z"})
        body["parameters"] = {"trend_sma": 0}
        run_id = test_client.post("/api/runs", json=body).json()["run_id"]
        wait_status(test_client, run_id, {"done", "failed"})
        payload = test_client.get(f"/api/runs/{run_id}/result").json()
    limits = payload["limits"]
    assert limits["bars_truncated"] and limits["bars_returned"] == 100
    assert limits["bars_first_index"] == limits["bars_total"] - 100
    assert len(payload["bars"]["close"]) == 100
    assert limits["trades_total"] > 10
    assert limits["trades_truncated"] and len(payload["result"]["trades"]) == 10
    assert payload["report"]["run"]["trade_count"] == limits["trades_total"]
    assert "every bar was used" in limits["note"]


def test_coinbase_run_through_a_fake_transport(tmp_path):
    jobs = JobManager(settings(cache_dir=tmp_path / "cache"), target=fake_coinbase_child)
    body = run_body(
        strategy_id="donchian_breakout",
        data={
            "provider": "coinbase",
            "symbol": "BTC-USD",
            "timeframe": "1h",
            "start": "2026-09-01T00:00:00Z",
            "end": "2026-10-15T00:00:00Z",
        },
    )
    try:
        with client(jobs, cache_dir=tmp_path / "cache") as test_client:
            run_id = test_client.post("/api/runs", json=body).json()["run_id"]
            events = read_events(test_client, run_id)
            payload = test_client.get(f"/api/runs/{run_id}/result").json()
    finally:
        jobs.shutdown()
    assert events[-1]["type"] == "run_done", events[-1]
    assert payload["source"]["provider"] == "coinbase"
    assert payload["source"]["mode"] == "PUBLIC EXCHANGE DATA"
    assert "chunk" in next(e["detail"] for e in events if e["type"] == "stage_progress")


def test_csv_preview_ok_and_with_problems():
    with client() as test_client:
        good = post_form(test_client, "/api/csv/preview", {"options": US}, sample_csv(3))
        assert good.status_code == 200, good.text
        document = good.json()
        assert document["ok"] is True and document["timeframe"] == "5m"
        assert document["bar_count"] > 0 and document["source"]["mode"] == "USER CSV"
        assert document["report"]["mapping"]["close"] == "close"
        assert "not kept" in document["note"]
        bad = post_form(
            test_client, "/api/csv/preview", {"options": US}, sample_csv(3, problems=True)
        )
    assert bad.status_code == 200
    assert bad.json()["ok"] is False
    report = bad.json()["report"]
    assert report["problem_count"] >= 3
    located = {(problem["line"], problem["column"]) for problem in report["problems"]}
    assert (7, "open") in located and (11, "open") in located


def test_csv_run_end_to_end():
    options = {"strategy_id": "orb", "honesty": LIGHT_HONESTY, "csv": {"market": "us_equity"}}
    with client() as test_client:
        created = post_form(
            test_client,
            "/api/runs/csv",
            {"options": json.dumps(options), "timezone": "America/New_York"},
            sample_csv(20),
        )
        assert created.status_code == 201, created.text
        run_id = created.json()["run_id"]
        events = read_events(test_client, run_id)
        payload = test_client.get(f"/api/runs/{run_id}/result").json()
    assert events[-1]["type"] == "run_done", events[-1]
    assert payload["source"]["mode"] == "USER CSV"
    assert payload["csv_report"]["rows"] > 0
    assert payload["request"]["csv"]["timezone"] == "America/New_York"


def test_cancel_endpoint_and_result_states():
    jobs = JobManager(settings(), target=stuck_child)
    try:
        with client(jobs) as test_client:
            run_id = test_client.post("/api/runs", json=run_body()).json()["run_id"]
            assert_error(test_client.get(f"/api/runs/{run_id}/result"), "run_not_finished", 409)
            assert test_client.delete(f"/api/runs/{run_id}").status_code == 200
            document = wait_status(test_client, run_id, {"cancelled"})
            assert document["error"]["code"] == "run_cancelled"
            events = read_events(test_client, run_id)
            assert events[-1]["code"] == "run_cancelled"
            assert_error(test_client.get(f"/api/runs/{run_id}/result"), "run_cancelled", 409)
    finally:
        jobs.shutdown()
    assert jobs.live_processes() == 0


def test_openapi_matches_the_committed_contract():
    assert OPENAPI_PATH.read_text(encoding="utf-8") == openapi_text()
    schema = json.loads(openapi_text())
    assert "/api/runs" in schema["paths"] and "/api/runs/{run_id}/result" in schema["paths"]
    assert not any(path.startswith("/api/dev") for path in schema["paths"])


@pytest.mark.parametrize(("environment", "expected"), [("production", 404), ("development", 200)])
def test_docs_and_fake_runs_follow_the_environment(environment, expected):
    with client(environment=environment) as test_client:
        assert test_client.get("/api/docs").status_code == expected
        assert test_client.get("/api/openapi.json").status_code == expected
        fake = test_client.post("/api/dev/fake-runs")
        assert fake.status_code == (404 if environment == "production" else 201)


def test_gzip_body_is_valid():
    with client() as test_client:
        run_id = test_client.post("/api/runs", json=run_body()).json()["run_id"]
        wait_status(test_client, run_id, {"done"})
        manager = test_client.app.state.jobs
        record = manager.get(run_id)
        assert json.loads(gzip.decompress(manager.compressed_result(record)))["run_id"] == run_id
