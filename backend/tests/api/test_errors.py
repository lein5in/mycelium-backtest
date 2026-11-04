import json
import typing

import pytest

from app.api import runs as runs_api
from app.data import errors as data_errors
from app.error_codes import ErrorCode
from app.errors import STATUS, classify
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
from tests.jobs.children import stuck_child

COINBASE = {
    "provider": "coinbase",
    "symbol": "BTC-USD",
    "timeframe": "1h",
    "start": "2026-09-01T00:00:00Z",
    "end": "2026-09-10T00:00:00Z",
}
LEAKS = ("Traceback", 'File "', "RuntimeError", "C:\\", "/home/", "secret-detail", ".py")


def data(**overrides):
    return {**run_body()["data"], **overrides}


def test_every_code_has_a_status():
    assert set(typing.get_args(ErrorCode)) == set(STATUS)


@pytest.mark.parametrize(
    ("body", "code", "status", "field"),
    [
        ({"data": run_body()["data"]}, "invalid_request", 400, "strategy_id"),
        ({**run_body(), "unexpected": 1}, "invalid_request", 400, "unexpected"),
        (run_body(parameters={"rsi_period": 1}), "invalid_request", 400, "parameters"),
        (run_body(data=data(end="2027-01-01T00:00:00Z")), "range_too_large", 400, "data.end"),
        (run_body(data=data(end="2023-12-01T00:00:00Z")), "range_invalid", 400, "data.end"),
        (run_body(data={**COINBASE, "symbol": "DOGE-XYZ"}), "symbol_not_supported", 400, None),
        (
            run_body(strategy_id="gap_fade", data=COINBASE),
            "market_not_compatible",
            400,
            None,
        ),
        (run_body(data={**COINBASE, "provider": "yahoo"}), "provider_unavailable", 503, None),
        (run_body(data=data(timeframe="1h")), "invalid_request", 400, "data.timeframe"),
    ],
)
def test_request_errors_are_shaped(body, code, status, field):
    with client() as test_client:
        body_out = assert_error(test_client.post("/api/runs", json=body), code, status)
    assert body_out["message"]
    if field is not None:
        fields = [problem["field"] for problem in body_out["details"]["problems"]]
        assert any(name.startswith(field) for name in fields), fields


def test_wrong_content_type_and_unknown_route():
    with client() as test_client:
        response = test_client.post(
            "/api/runs", content=b"strategy_id=orb", headers={"Content-Type": "text/plain"}
        )
        assert_error(response, "invalid_request", 400)
        assert_error(test_client.get("/api/nothing-here"), "not_found", 404)
        assert_error(test_client.put("/api/health"), "invalid_request", 400)


def test_json_body_limit():
    with client(max_json_bytes=2048) as test_client:
        body = run_body(parameters={f"p{i}": "x" * 100 for i in range(30)})
        assert_error(test_client.post("/api/runs", json=body), "invalid_request", 400)


def test_file_too_large_declared_and_streamed():
    content = sample_csv(5)
    with client(max_csv_bytes=4096) as test_client:
        body, content_type = multipart({}, content)
        declared = test_client.post(
            "/api/csv/preview", content=body, headers={"Content-Type": content_type}
        )
        assert_error(declared, "file_too_large", 413)

        def chunks():
            for start in range(0, len(body), 1024):
                yield body[start : start + 1024]

        streamed = test_client.post(
            "/api/runs/csv", content=chunks(), headers={"Content-Type": content_type}
        )
        assert_error(streamed, "file_too_large", 413)


def test_csv_invalid_on_preview_and_on_run():
    with client() as test_client:
        body, content_type = multipart({}, b"")
        assert_error(
            test_client.post(
                "/api/csv/preview", content=body, headers={"Content-Type": content_type}
            ),
            "csv_invalid",
            422,
        )
        options = {"strategy_id": "orb", "honesty": LIGHT_HONESTY, "csv": {"market": "us_equity"}}
        body, content_type = multipart(
            {"options": json.dumps(options)}, sample_csv(3, problems=True)
        )
        created = test_client.post(
            "/api/runs/csv", content=body, headers={"Content-Type": content_type}
        )
        run_id = created.json()["run_id"]
        events = read_events(test_client, run_id)
        document = wait_status(test_client, run_id, {"failed"})
        result = test_client.get(f"/api/runs/{run_id}/result")
    assert [event["type"] for event in events] == ["run_failed"]
    assert events[0]["code"] == "csv_invalid" and events[0]["stage"] == "DATA"
    assert document["error"]["details"]["csv_report"]["problem_count"] >= 3
    assert_error(result, "csv_invalid", 422)


def test_multipart_garbage_is_invalid_request():
    with client() as test_client:
        response = test_client.post(
            "/api/csv/preview",
            content=b"--x\r\nnot a part",
            headers={"Content-Type": "multipart/form-data; boundary=x"},
        )
        assert_error(response, "invalid_request", 400)


def test_rate_limited_requests():
    with client(requests_per_minute_per_ip=3) as test_client:
        statuses = [test_client.get("/api/health").status_code for _ in range(4)]
        response = test_client.get("/api/health")
    assert statuses[:3] == [200, 200, 200]
    assert_error(response, "rate_limited", 429)
    assert int(response.headers["retry-after"]) >= 1


def test_capacity_busy_over_the_api():
    jobs = JobManager(settings(max_concurrent_runs=1, queue_size=0), target=stuck_child)
    try:
        with client(jobs) as test_client:
            assert test_client.post("/api/runs", json=run_body()).status_code == 201
            response = test_client.post("/api/runs", json=run_body())
            assert_error(response, "capacity_busy", 503)
            assert int(response.headers["retry-after"]) > 0
    finally:
        jobs.shutdown()


def test_timeout_over_the_api():
    jobs = JobManager(settings(run_timeout_seconds=1.0), target=stuck_child)
    try:
        with client(jobs) as test_client:
            run_id = test_client.post("/api/runs", json=run_body()).json()["run_id"]
            events = read_events(test_client, run_id)
            assert events[-1]["type"] == "run_failed" and events[-1]["code"] == "run_timeout"
            assert_error(test_client.get(f"/api/runs/{run_id}/result"), "run_timeout", 504)
    finally:
        jobs.shutdown()
    assert jobs.live_processes() == 0


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (data_errors.NotFoundError("No candles.", "coinbase"), "no_data"),
        (data_errors.RateLimitedError("Slow down.", "kraken"), "provider_rate_limited"),
        (data_errors.NetworkError("Down.", "coinbase"), "provider_unavailable"),
        (data_errors.OutOfRangeError("Too old.", "kraken"), "range_invalid"),
        (data_errors.InvalidSymbolError("No.", "kraken"), "symbol_not_supported"),
        (data_errors.BusyError("Busy.", "coinbase"), "capacity_busy"),
        (KeyError("secret-detail"), "internal_error"),
    ],
)
def test_internal_errors_map_to_the_taxonomy(error, code):
    mapped = classify(error, "DATA")
    assert mapped.code == code and mapped.stage == "DATA"
    assert "secret-detail" not in mapped.message


def test_unexpected_exception_leaks_nothing(monkeypatch, caplog):
    def explode(*args, **kwargs):
        raise RuntimeError("secret-detail at C:\\Users\\x\\app.py line 3")

    monkeypatch.setattr(runs_api, "provider_job", explode)
    with client() as test_client:
        response = test_client.post("/api/runs", json=run_body())
    body = assert_error(response, "internal_error", 500)
    text = response.text
    assert not any(fragment in text for fragment in LEAKS), text
    assert body["request_id"] in caplog.text
