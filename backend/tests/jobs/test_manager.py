import time

import pytest

from app.errors import ApiError
from app.jobs.limits import ClientKeys, RequestRate, RunQuota
from app.jobs.manager import JobManager
from app.jobs.requests import RunRequest, provider_job
from app.main import create_app
from tests.api_helpers import assert_error, client, run_body, settings, wait_status
from tests.jobs.children import crashing_child, quick_child, stuck_child


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def job():
    request = RunRequest.model_validate(run_body())
    return provider_job(request, create_app(settings()).state.providers)


def wait_finished(manager: JobManager, run_id: str, timeout: float = 30.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = manager.get(run_id)
        if record is not None and record.finished:
            return record
        time.sleep(0.02)
    raise AssertionError("run did not finish")


@pytest.fixture
def managers():
    created: list[JobManager] = []

    def make(target=quick_child, clock=time.monotonic, **overrides) -> JobManager:
        manager = JobManager(settings(**overrides), clock=clock, target=target)
        created.append(manager)
        return manager

    yield make
    for manager in created:
        manager.shutdown()
        assert manager.live_processes() == 0


def test_capacity_and_queue_limits(managers):
    manager = managers(stuck_child, max_concurrent_runs=2, queue_size=1, run_timeout_seconds=30)
    running = [manager.submit(job(), f"k{i}") for i in range(2)]
    queued = manager.submit(job(), "k2")
    assert [record.status for record in running] == ["running", "running"]
    assert queued.status == "queued"
    with pytest.raises(ApiError) as caught:
        manager.submit(job(), "k3")
    assert caught.value.code == "capacity_busy"
    assert caught.value.retry_after and caught.value.retry_after > 0
    assert manager.counts() == {"running": 2, "queued": 1, "retained": 3}


def test_queued_run_starts_when_a_slot_frees(managers):
    manager = managers(quick_child, max_concurrent_runs=1, queue_size=5)
    first = manager.submit(job(), "a")
    second = manager.submit(job(), "b")
    assert second.status == "queued"
    assert wait_finished(manager, first.run_id).status == "done"
    assert wait_finished(manager, second.run_id).status == "done"


def test_hard_timeout_kills_a_stuck_child(managers):
    manager = managers(stuck_child, run_timeout_seconds=1.5)
    record = manager.submit(job(), "k")
    started = time.monotonic()
    finished = wait_finished(manager, record.run_id)
    assert time.monotonic() - started < 15
    assert finished.status == "failed"
    last = finished.events[-1]
    assert last.type == "run_failed"
    assert last.code == "run_timeout"
    assert last.stage == "DATA"
    assert manager.live_processes() == 0


def test_cancel_running_and_queued(managers):
    manager = managers(stuck_child, max_concurrent_runs=1, queue_size=3, run_timeout_seconds=60)
    running = manager.submit(job(), "a")
    queued = manager.submit(job(), "b")
    manager.cancel(queued.run_id)
    assert queued.status == "cancelled"
    assert [event.type for event in queued.events] == ["run_failed"]
    assert queued.events[0].code == "run_cancelled"
    deadline = time.monotonic() + 20
    while not running.events and time.monotonic() < deadline:
        time.sleep(0.05)
    manager.cancel(running.run_id)
    finished = wait_finished(manager, running.run_id)
    assert finished.status == "cancelled"
    assert finished.events[-1].code == "run_cancelled"
    assert [event.seq for event in finished.events] == list(range(len(finished.events)))
    assert manager.live_processes() == 0


def test_child_that_dies_ends_with_internal_error(managers):
    manager = managers(crashing_child)
    record = wait_finished(manager, manager.submit(job(), "k").run_id)
    assert record.status == "failed"
    assert record.events[-1].code == "internal_error"


def test_retention_purges_finished_runs(managers):
    clock = FakeClock()
    manager = managers(quick_child, clock=clock, retention_minutes=1, max_retained_runs=2)
    first = manager.submit(job(), "a")
    wait_finished(manager, first.run_id)
    clock.now += 59
    assert manager.get(first.run_id) is not None
    clock.now += 2
    assert manager.get(first.run_id) is None
    ids = [manager.submit(job(), "a").run_id for _ in range(3)]
    for run_id in ids:
        record = manager._records[run_id]
        while not record.finished:
            time.sleep(0.02)
    manager.purge()
    assert manager.counts()["retained"] == 2
    assert manager.get(ids[0]) is None
    assert record.job is None and record.csv_content is None


def test_run_quota_per_hour_and_concurrency():
    clock = FakeClock()
    quota = RunQuota(per_hour=3, concurrent=2, clock=clock)
    quota.acquire("a")
    quota.acquire("a")
    with pytest.raises(ApiError) as caught:
        quota.acquire("a")
    assert caught.value.code == "rate_limited"
    quota.release("a")
    quota.acquire("a")
    quota.release("a")
    quota.release("a")
    with pytest.raises(ApiError) as caught:
        quota.acquire("a")
    assert 0 < caught.value.retry_after <= 3_600
    quota.acquire("b")
    clock.now += 3_600
    quota.acquire("a")


def test_request_rate_bucket():
    clock = FakeClock()
    rate = RequestRate(per_minute=2, clock=clock)
    assert rate.hit("a") is None
    assert rate.hit("a") is None
    assert rate.hit("a") == 30
    assert rate.hit("b") is None
    clock.now += 30
    assert rate.hit("a") is None


def test_client_keys_respect_the_trusted_proxy_setting():
    direct = ClientKeys(forwarded_hops=0)
    assert direct.address("10.0.0.1", "1.1.1.1") == "10.0.0.1"
    proxied = ClientKeys(forwarded_hops=1)
    assert proxied.address("10.0.0.1", "6.6.6.6, 1.1.1.1") == "1.1.1.1"
    assert proxied.address("10.0.0.1", None) == "10.0.0.1"
    key = proxied.key("10.0.0.1", "1.1.1.1")
    assert "1.1.1.1" not in key and len(key) == 32


def submit_status(test_client, forwarded_for: str) -> int:
    response = test_client.post(
        "/api/runs", json=run_body(), headers={"X-Forwarded-For": forwarded_for}
    )
    return response.status_code


def test_per_ip_limit_without_trusted_proxy_counts_the_peer():
    jobs = JobManager(settings(concurrent_runs_per_ip=1), target=stuck_child)
    try:
        with client(jobs, concurrent_runs_per_ip=1) as test_client:
            assert submit_status(test_client, "1.1.1.1") == 201
            response = test_client.post(
                "/api/runs", json=run_body(), headers={"X-Forwarded-For": "2.2.2.2"}
            )
            body = assert_error(response, "rate_limited", 429)
            assert int(response.headers["retry-after"]) > 0
            assert "2.2.2.2" not in str(body)
    finally:
        jobs.shutdown()
    assert jobs.live_processes() == 0


def test_per_ip_limit_with_trusted_proxy_uses_forwarded_address():
    jobs = JobManager(settings(concurrent_runs_per_ip=1), target=stuck_child)
    try:
        with client(jobs, concurrent_runs_per_ip=1, forwarded_hops=1) as test_client:
            assert submit_status(test_client, "1.1.1.1") == 201
            assert submit_status(test_client, "2.2.2.2") == 201
            assert submit_status(test_client, "1.1.1.1") == 429
    finally:
        jobs.shutdown()


def test_runs_per_hour_over_the_api():
    jobs = JobManager(settings(runs_per_hour_per_ip=2), target=quick_child)
    try:
        with client(jobs, runs_per_hour_per_ip=2) as test_client:
            ids = [
                test_client.post("/api/runs", json=run_body()).json()["run_id"] for _ in range(2)
            ]
            for run_id in ids:
                wait_status(test_client, run_id, {"done"})
            response = test_client.post("/api/runs", json=run_body())
            assert_error(response, "rate_limited", 429)
            assert int(response.headers["retry-after"]) > 3_000
    finally:
        jobs.shutdown()
