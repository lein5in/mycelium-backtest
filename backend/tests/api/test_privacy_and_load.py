import builtins
import io
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

from app.config import BACKEND_DIR
from app.jobs.pipeline import Reporter, execute
from app.jobs.requests import CsvRunOptions, csv_job
from tests.api.csv_files import MARKER, multipart, sample_csv
from tests.api_helpers import LIGHT_HONESTY, client, read_events, run_body, settings, wait_status

IGNORED = {".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".cache"}
CLIENT_IP = "203.0.113.77"
CSV_OPTIONS = {"strategy_id": "orb", "honesty": LIGHT_HONESTY, "csv": {"market": "us_equity"}}


def listing(root: Path, recursive: bool) -> dict[str, float]:
    found = {}
    walker = os.walk(root) if recursive else [(str(root), [], os.listdir(root))]
    for directory, folders, files in walker:
        folders[:] = [name for name in folders if name not in IGNORED]
        for name in files:
            path = os.path.join(directory, name)
            try:
                found[path] = os.stat(path).st_mtime
            except OSError:
                continue
    return found


def contains_marker(path: str) -> bool:
    try:
        if os.path.getsize(path) > 50 * 1024 * 1024:
            return False
        return MARKER.encode() in Path(path).read_bytes()
    except OSError:
        return False


def csv_run(test_client, content: bytes) -> str:
    body, content_type = multipart({"options": json.dumps(CSV_OPTIONS)}, content)
    response = test_client.post(
        "/api/runs/csv",
        content=body,
        headers={"Content-Type": content_type, "X-Forwarded-For": CLIENT_IP},
    )
    assert response.status_code == 201, response.text
    return response.json()["run_id"]


def test_csv_run_creates_no_file(tmp_path):
    temp_root = Path(tempfile.gettempdir())
    before_backend = listing(BACKEND_DIR, True)
    before_temp = listing(temp_root, True)
    with client(cache_dir=tmp_path / "cache") as test_client:
        run_id = csv_run(test_client, sample_csv(10))
        events = read_events(test_client, run_id)
    assert events[-1]["type"] == "run_done"
    after_backend = listing(BACKEND_DIR, True)
    after_temp = listing(temp_root, True)
    assert set(after_backend) - set(before_backend) == set()
    created = set(after_temp) - set(before_temp)
    changed = {path for path, stamp in after_temp.items() if before_temp.get(path) != stamp}
    assert not [path for path in created | changed if contains_marker(path)]
    assert not (tmp_path / "cache").exists()


def test_csv_pipeline_never_opens_a_file(monkeypatch):
    opened = []
    real_open = builtins.open

    def guarded(file, mode="r", *args, **kwargs):
        if any(flag in mode for flag in "wax+"):
            opened.append(str(file))
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", guarded)
    monkeypatch.setattr(io, "open", guarded)
    options = CsvRunOptions.model_validate(CSV_OPTIONS)
    events = []
    execute("p", csv_job(options), Reporter(events.append), settings(), sample_csv(10))
    assert opened == []
    assert events[0]["type"] == "run_started"


def test_logs_hold_no_csv_content_and_no_ip(caplog, capfd):
    caplog.set_level(logging.DEBUG)
    with client(forwarded_hops=1) as test_client:
        good = csv_run(test_client, sample_csv(5))
        bad = csv_run(test_client, sample_csv(3, problems=True))
        read_events(test_client, good)
        read_events(test_client, bad)
        test_client.get("/api/does-not-exist", headers={"X-Forwarded-For": CLIENT_IP})
    captured = capfd.readouterr()
    combined = caplog.text + captured.out + captured.err
    assert MARKER not in combined
    assert CLIENT_IP not in combined


def test_light_load_against_capacity_two_and_queue_ten():
    timings = {}
    with client(max_concurrent_runs=2, queue_size=10) as test_client:
        health_failures: list[int] = []
        health_latency: list[float] = []
        stop = threading.Event()

        def probe():
            while not stop.is_set():
                started = time.perf_counter()
                status = test_client.get("/api/health").status_code
                health_latency.append(time.perf_counter() - started)
                if status != 200:
                    health_failures.append(status)
                time.sleep(0.1)

        prober = threading.Thread(target=probe, daemon=True)
        prober.start()
        started = time.perf_counter()
        responses = [test_client.post("/api/runs", json=run_body()) for _ in range(20)]
        timings["submit_seconds"] = time.perf_counter() - started
        accepted = [r.json()["run_id"] for r in responses if r.status_code == 201]
        refused = [r for r in responses if r.status_code != 201]
        for run_id in accepted:
            wait_status(test_client, run_id, {"done"}, timeout=180)
        timings["all_done_seconds"] = time.perf_counter() - started
        stop.set()
        prober.join(5)
    assert len(accepted) == 12
    assert len(refused) == 8
    for response in refused:
        assert response.status_code == 503
        assert response.json()["code"] == "capacity_busy"
        assert int(response.headers["retry-after"]) > 0
    assert health_failures == []
    assert health_latency and max(health_latency) < 2.0
    timings["health_probes"] = len(health_latency)
    timings["health_max_ms"] = round(1000 * max(health_latency), 1)
    print("LOAD", {key: round(value, 2) for key, value in timings.items()})
