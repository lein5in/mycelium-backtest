import json

import pytest
from jsonschema import Draft202012Validator

from app.jobs import pipeline
from app.jobs.pipeline import Reporter, execute
from app.jobs.requests import RunRequest, provider_job
from app.runs.contracts import SCHEMA_PATH
from app.runs.events import CHECK_IDS, STAGES
from tests.api_helpers import assert_error, client, read_events, run_body, settings, wait_status


@pytest.fixture(scope="module")
def finished_run():
    with client() as test_client:
        run_id = test_client.post("/api/runs", json=run_body()).json()["run_id"]
        events = read_events(test_client, run_id)
        yield test_client, run_id, events


def test_real_run_order_and_completeness(finished_run):
    _, run_id, events = finished_run
    assert [event["seq"] for event in events] == list(range(len(events)))
    assert events[0]["type"] == "run_started"
    assert events[0]["bar_count"] > 0
    assert events[-1]["type"] == "run_done"
    started = [event["stage"] for event in events if event["type"] == "stage_started"]
    done = [event["stage"] for event in events if event["type"] == "stage_done"]
    assert started == list(STAGES)
    assert done == list(STAGES)
    for stage in STAGES:
        indexes = [i for i, e in enumerate(events) if e.get("stage") == stage]
        kinds = [events[i]["type"] for i in indexes]
        assert kinds[0] == "stage_started" and kinds[-1] == "stage_done"
    checks = [event for event in events if event["type"] == "check_done"]
    assert [check["check_id"] for check in checks] == list(CHECK_IDS)
    assert all(event["run_id"] == run_id for event in events)
    bars = [
        e["bar_index"]
        for e in events
        if e["type"] == "stage_progress" and e["stage"] == "SIMULATOR"
    ]
    assert bars == sorted(bars) and bars[-1] == events[0]["bar_count"] - 1


def test_every_event_matches_the_committed_schema(finished_run):
    _, _, events = finished_run
    validator = Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
    for event in events:
        validator.validate(event)
        assert event["schema_version"] == 2


def test_replay_after_completion_returns_the_full_sequence(finished_run):
    test_client, run_id, events = finished_run
    assert read_events(test_client, run_id) == events


def test_replay_with_last_event_id(finished_run):
    test_client, run_id, events = finished_run
    replay = read_events(test_client, run_id, {"Last-Event-ID": "10"})
    assert replay == events[11:]
    assert read_events(test_client, run_id, {"Last-Event-ID": str(len(events) - 1)}) == []


def test_stream_headers_and_unknown_id(finished_run):
    test_client, run_id, _ = finished_run
    with test_client.stream("GET", f"/api/runs/{run_id}/events") as response:
        assert response.headers["content-type"].startswith("text/event-stream")
        assert "no-store" in response.headers["cache-control"]
        response.read()
    assert_error(test_client.get("/api/runs/unknown/events"), "run_not_found", 404)
    assert_error(test_client.get("/api/runs/unknown"), "run_not_found", 404)


def test_subscriber_limit(finished_run):
    test_client, run_id, _ = finished_run
    manager = test_client.app.state.jobs
    record = manager.get(run_id)
    limit = manager.settings.max_subscribers_per_run
    for _ in range(limit):
        assert manager.subscribe(record)
    try:
        response = test_client.get(f"/api/runs/{run_id}/events")
        assert_error(response, "rate_limited", 429)
        assert response.headers["retry-after"]
    finally:
        for _ in range(limit):
            manager.unsubscribe(record)
    assert read_events(test_client, run_id)


def test_status_document(finished_run):
    test_client, run_id, events = finished_run
    document = wait_status(test_client, run_id, {"done"})
    assert document["stage"] == "REPORTER"
    assert document["verdict"] == events[-1]["verdict"]
    assert document["events"] == len(events)
    assert document["started_at"] and document["finished_at"]


def test_events_never_lead_the_engine(monkeypatch):
    log: list[tuple] = []
    original = pipeline.run_plan

    def traced_run_plan(bars, plan, config, name, sessions, progress, closed_trades):
        def traced_closed(trades):
            for trade in trades:
                log.append(("closed", trade.entry_index, trade.exit_index))
            closed_trades(trades)

        output = original(bars, plan, config, name, sessions, progress, traced_closed)
        log.append(("returned",))
        return output

    monkeypatch.setattr(pipeline, "run_plan", traced_run_plan)
    request = RunRequest.model_validate(run_body())
    job = provider_job(request, client().app.state.providers)
    execute("t", job, Reporter(lambda payload: log.append(("event", payload))), settings())

    returned = log.index(("returned",))
    events = [(i, entry[1]) for i, entry in enumerate(log) if entry[0] == "event"]
    simulator_done = next(
        i for i, e in events if e["type"] == "stage_done" and e["stage"] == "SIMULATOR"
    )
    assert simulator_done > returned
    clusters = [(i, e) for i, e in events if e["type"] == "trade_cluster"]
    assert clusters
    fills = 0
    for index, cluster in clusters:
        closed = [entry for entry in log[:index] if entry[0] == "closed"]
        fills += cluster["fills"]
        assert 2 * len(closed) >= fills
        assert cluster["region"]["end_bar"] in {entry[2] for entry in closed}
        assert cluster["region"]["start_bar"] in {entry[1] for entry in closed}
    stage_order = [e["stage"] for _, e in events if e["type"] == "stage_started"]
    assert stage_order == list(STAGES)
