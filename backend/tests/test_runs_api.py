import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.runs.events import run_event_adapter
from app.runs.scenario import Scenario, scripted_steps
from app.runs.stream import HEARTBEAT, stream_events


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(heartbeat_seconds=15)))


def parse_stream(text: str) -> tuple[list[dict], list[str]]:
    events, comments = [], []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        lines = block.split("\n")
        if lines[0].startswith(":"):
            comments.append(block)
            continue
        data = [line.removeprefix("data: ") for line in lines if line.startswith("data: ")]
        ids = [line.removeprefix("id: ") for line in lines if line.startswith("id: ")]
        assert len(data) == 1
        payload = json.loads(data[0])
        assert ids == [str(payload["seq"])]
        events.append(payload)
    return events, comments


def create(client: TestClient, **body: object) -> str:
    response = client.post("/api/runs", json=body or None)
    assert response.status_code == 201
    payload = response.json()
    assert payload["events_url"] == f"/api/runs/{payload['run_id']}/events"
    return payload["run_id"]


def test_create_run_without_body_defaults_to_success(client: TestClient) -> None:
    response = client.post("/api/runs")
    assert response.status_code == 201
    run_id = response.json()["run_id"]
    registry = client.app.state.run_registry
    run = registry.get(run_id)
    assert run.scenario is Scenario.SUCCESS
    assert run.speed == 1.0


@pytest.mark.parametrize(
    "body",
    [{"scenario": "explode"}, {"speed": 0}, {"speed": -1}, {"speed": 5000}, {"extra": 1}],
)
def test_create_run_rejects_invalid_input(client: TestClient, body: dict) -> None:
    assert client.post("/api/runs", json=body).status_code == 422


def test_unknown_run_gives_404(client: TestClient) -> None:
    assert client.get("/api/runs/does-not-exist/events").status_code == 404


def test_stream_headers(client: TestClient) -> None:
    run_id = create(client, speed=1000)
    response = client.get(f"/api/runs/{run_id}/events")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in response.headers["cache-control"]
    assert response.headers["x-accel-buffering"] == "no"


def test_success_stream_is_complete_and_valid(client: TestClient) -> None:
    run_id = create(client, speed=1000)
    events, _ = parse_stream(client.get(f"/api/runs/{run_id}/events").text)
    expected = [step.payload["type"] for step in scripted_steps(Scenario.SUCCESS)]
    assert [event["type"] for event in events] == expected
    assert [event["seq"] for event in events] == list(range(len(events)))
    assert all(event["run_id"] == run_id for event in events)
    for event in events:
        run_event_adapter.validate_python(event)
    assert events[-1] == {**events[-1], "type": "run_done", "verdict": "FRAGILE"}


def test_failure_stream_ends_with_run_failed(client: TestClient) -> None:
    run_id = create(client, scenario="failure", speed=1000)
    events, _ = parse_stream(client.get(f"/api/runs/{run_id}/events").text)
    types = [event["type"] for event in events]
    assert types[-1] == "run_failed"
    assert "run_done" not in types


def test_speed_factor_changes_wall_time(client: TestClient) -> None:
    fast_id = create(client, speed=1000)
    started = time.perf_counter()
    client.get(f"/api/runs/{fast_id}/events")
    fast = time.perf_counter() - started
    slow_id = create(client, speed=20)
    started = time.perf_counter()
    client.get(f"/api/runs/{slow_id}/events")
    slow = time.perf_counter() - started
    total = sum(step.delay for step in scripted_steps(Scenario.SUCCESS))
    assert fast < 0.5
    assert slow >= total / 20 * 0.9
    assert slow > fast


def test_heartbeat_comments_while_idle() -> None:
    client = TestClient(create_app(Settings(heartbeat_seconds=0.01)))
    run_id = create(client, speed=10)
    events, comments = parse_stream(client.get(f"/api/runs/{run_id}/events").text)
    assert comments
    assert all(comment == HEARTBEAT.strip() for comment in comments)
    assert events[-1]["type"] == "run_done"


def test_stream_stops_producing_after_disconnect() -> None:
    checks = 0

    async def disconnected_after_three_checks() -> bool:
        nonlocal checks
        checks += 1
        return checks > 3

    async def collect() -> list[str]:
        stream = stream_events(
            scripted_steps(Scenario.SUCCESS), "r1", 1000, 15, disconnected_after_three_checks
        )
        return [chunk async for chunk in stream]

    chunks = asyncio.run(collect())
    assert len(chunks) <= 3
    assert len(chunks) < len(scripted_steps(Scenario.SUCCESS))
