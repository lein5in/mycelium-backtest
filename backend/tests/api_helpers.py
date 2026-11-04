import json
import time

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

SAMPLE_DATA = {
    "provider": "samples",
    "symbol": "SAMPLE-A",
    "timeframe": "5m",
    "start": "2024-01-02T00:00:00Z",
    "end": "2024-02-01T00:00:00Z",
}
LIGHT_HONESTY = {"random_draws": 100, "sweep": False}


def settings(**overrides) -> Settings:
    values = {
        "heartbeat_seconds": 0.5,
        "runs_per_hour_per_ip": 1_000,
        "concurrent_runs_per_ip": 100,
        "requests_per_minute_per_ip": 100_000,
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def client(jobs=None, **overrides) -> TestClient:
    return TestClient(create_app(settings(**overrides), jobs))


def run_body(**overrides) -> dict:
    body = {
        "strategy_id": "rsi_mean_reversion",
        "data": dict(SAMPLE_DATA),
        "honesty": dict(LIGHT_HONESTY),
    }
    body.update(overrides)
    return body


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
        payload = json.loads(data[0])
        assert ids == [str(payload["seq"])]
        events.append(payload)
    return events, comments


def read_events(test_client: TestClient, run_id: str, headers=None) -> list[dict]:
    with test_client.stream("GET", f"/api/runs/{run_id}/events", headers=headers or {}) as stream:
        assert stream.status_code == 200
        text = "".join(stream.iter_text())
    return parse_stream(text)[0]


def wait_status(test_client: TestClient, run_id: str, states, timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        document = test_client.get(f"/api/runs/{run_id}").json()
        if document["status"] in states:
            return document
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not reach {states}")


def assert_error(response, code: str, status: int) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"code", "status", "message", "stage", "details", "request_id"}
    assert body["code"] == code
    assert body["status"] == status
    assert body["request_id"] == response.headers["x-request-id"]
    return body
