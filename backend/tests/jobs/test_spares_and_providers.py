import time

from app.jobs.manager import JobManager
from app.jobs.requests import RunRequest, provider_job
from app.main import create_app
from tests.api_helpers import run_body, settings
from tests.jobs.children import fake_kraken_child, pid_child, stuck_child
from tests.jobs.test_manager import job, wait_finished

KRAKEN_DATA = {
    "provider": "kraken",
    "symbol": "BTC-USD",
    "timeframe": "1h",
    "start": "2026-10-20T00:00:00Z",
    "end": "2026-11-03T00:00:00Z",
}


def wait_until(predicate, timeout: float = 40.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("condition not reached")


def warmed(manager: JobManager, count: int) -> JobManager:
    manager.warm()
    wait_until(lambda: manager.ready_spares() == count)
    return manager


def kraken_job():
    body = run_body(strategy_id="donchian_breakout", data=dict(KRAKEN_DATA))
    return provider_job(RunRequest.model_validate(body), create_app(settings()).state.providers)


def test_every_run_gets_a_fresh_warm_process(managers):
    manager = warmed(managers(pid_child, warm_spares=2, max_concurrent_runs=1), 2)
    seen_pids: set[int] = set()
    used: list[int] = []
    taken = []
    for _ in range(4):
        wait_until(lambda: manager.ready_spares() == 2)
        spares = list(manager._spares)
        seen_pids.update(manager.spare_pids())
        record = wait_finished(manager, manager.submit(job(), "k").run_id)
        assert record.status == "done"
        pid = int(record.result.decode())
        used.append(pid)
        taken.extend(spare for spare in spares if spare.process.pid == pid)
    assert len(set(used)) == 4
    assert set(used) <= seen_pids
    assert len(taken) == 4
    wait_until(lambda: all(spare.process.exitcode is not None for spare in taken))
    assert all(pid not in manager.spare_pids() for pid in used)


def test_spares_are_replenished_after_a_run(managers):
    manager = warmed(managers(pid_child, warm_spares=2), 2)
    before = set(manager.spare_pids())
    wait_finished(manager, manager.submit(job(), "k").run_id)
    wait_until(lambda: manager.ready_spares() == 2)
    after = set(manager.spare_pids())
    assert len(after) == 2
    assert len(before & after) == 1


def test_a_spare_that_dies_is_replaced(managers):
    manager = warmed(managers(pid_child, warm_spares=2), 2)
    victim = manager._spares[0]
    victim.process.kill()
    victim.process.join(5)
    wait_until(
        lambda: manager.ready_spares() == 2 and victim.process.pid not in manager.spare_pids()
    )
    record = wait_finished(manager, manager.submit(job(), "k").run_id)
    assert record.status == "done"
    assert int(record.result.decode()) != victim.process.pid


def test_shutdown_leaves_no_process_running():
    manager = warmed(JobManager(settings(warm_spares=2), target=stuck_child), 2)
    record = manager.submit(job(), "k")
    wait_until(lambda: len(record.events) >= 2)
    spares = list(manager._spares)
    running = list(manager._processes.values())
    manager.shutdown()
    assert manager.live_spares() == 0
    assert manager.live_processes() == 0
    assert all(process.exitcode is not None for process in running)
    assert all(spare.process.exitcode is not None for spare in spares)
    assert record.status == "cancelled"


def test_timeout_and_cancel_still_kill_a_warm_process(managers):
    manager = warmed(managers(stuck_child, warm_spares=2, run_timeout_seconds=1.5), 2)
    spares = list(manager._spares)
    timed_out = manager.submit(job(), "a")
    cancelled = manager.submit(job(), "b")
    wait_until(lambda: len(cancelled.events) >= 2)
    manager.cancel(cancelled.run_id)
    assert wait_finished(manager, timed_out.run_id).events[-1].code == "run_timeout"
    assert wait_finished(manager, cancelled.run_id).events[-1].code == "run_cancelled"
    assert all(spare.process.exitcode is not None for spare in spares)
    assert manager.live_processes() == 0


def test_runs_of_a_rate_limited_provider_wait_for_each_other(managers):
    manager = managers(fake_kraken_child, max_concurrent_runs=3, queue_size=5)
    first = manager.submit(kraken_job(), "a")
    second = manager.submit(kraken_job(), "b")
    other = manager.submit(job(), "c")
    assert first.status == "running"
    assert second.status == "queued"
    assert other.status == "running"
    assert manager.counts()["queued"] == 1
    first = wait_finished(manager, first.run_id, 60)
    second = wait_finished(manager, second.run_id, 60)
    assert wait_finished(manager, other.run_id, 60).status == "done"
    assert first.status == "done", first.events[-1]
    assert second.status == "done", second.events[-1]
    assert second.started_at >= first.finished_at
    assert first.events[0].type == "run_started" and first.events[0].bar_count > 300


def test_provider_limit_is_configurable(managers):
    manager = managers(stuck_child, max_concurrent_runs=3, runs_per_rate_limited_provider=2)
    runs = [manager.submit(kraken_job(), key) for key in "abc"]
    assert [record.status for record in runs] == ["running", "running", "queued"]
    manager.cancel(runs[0].run_id)
    wait_until(lambda: runs[2].status == "running")
