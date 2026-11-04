import gzip
import logging
import multiprocessing
import threading
import time
import uuid
from collections import Counter, OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import ValidationError

from app.config import Settings
from app.data.registry import MIN_INTERVALS
from app.errors import ApiError
from app.jobs.limits import Clock, RunQuota
from app.jobs.requests import Job
from app.jobs.worker import run_child, spare_child
from app.runs.events import RunEvent, Stage, run_event_adapter

logger = logging.getLogger("mycelium.jobs")

RunStatus = Literal["queued", "running", "done", "failed", "cancelled"]
TERMINAL: frozenset[str] = frozenset({"done", "failed", "cancelled"})
POLL_SECONDS = 0.05
JOIN_SECONDS = 5.0
CAPACITY_RETRY_SECONDS = 15
GZIP_LEVEL = 6
KEEPER_SECONDS = 0.5
RATE_LIMITED_PROVIDERS = frozenset(name for name, gap in MIN_INTERVALS.items() if gap > 0)
ChildTarget = Callable[..., None]


@dataclass
class RunRecord:
    run_id: str
    owner: str
    job: Job | None
    csv_content: bytes | None
    created_at: datetime
    status: RunStatus = "queued"
    stage: Stage | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    finished_clock: float | None = None
    verdict: str | None = None
    error: dict[str, Any] | None = None
    events: list[RunEvent] = field(default_factory=list)
    result: bytes | None = None
    result_gzip: bytes | None = None
    subscribers: int = 0
    provider: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def finished(self) -> bool:
        return self.status in TERMINAL


@dataclass
class Spare:
    process: multiprocessing.process.BaseProcess
    connection: Any
    ready: bool = False

    def poll_ready(self) -> bool:
        if not self.ready and self.process.is_alive():
            try:
                if self.connection.poll(0):
                    kind, _ = self.connection.recv()
                    self.ready = kind == "ready"
            except (EOFError, OSError):
                return False
        return self.ready


def provider_of(job: Job | None) -> str | None:
    if job is None or job.kind != "provider":
        return None
    return job.options.data.provider


@dataclass(frozen=True)
class Outcome:
    kind: Literal["done", "failed", "timeout", "cancelled", "crashed"]
    failure: dict[str, Any] | None = None


class JobManager:
    def __init__(
        self,
        settings: Settings,
        clock: Clock = time.monotonic,
        target: ChildTarget = run_child,
    ) -> None:
        self.settings = settings
        self.clock = clock
        self.target = target
        self.context = multiprocessing.get_context("spawn")
        self.quota = RunQuota(settings.runs_per_hour_per_ip, settings.concurrent_runs_per_ip, clock)
        self._records: OrderedDict[str, RunRecord] = OrderedDict()
        self._queue: deque[str] = deque()
        self._threads: dict[str, threading.Thread] = {}
        self._processes: dict[str, multiprocessing.process.BaseProcess] = {}
        self._providers: Counter[str] = Counter()
        self._lock = threading.Lock()
        self._closed = False
        self._spares: list[Spare] = []
        self._spare_lock = threading.Lock()
        self._keeper: threading.Thread | None = None
        self._keeper_wake = threading.Event()
        self._keeper_stop = threading.Event()

    def warm(self) -> None:
        with self._lock:
            if self._closed or self._keeper is not None or self.settings.warm_spares <= 0:
                return
            self._keeper = threading.Thread(target=self._keep, name="run-spares", daemon=True)
            self._keeper.start()

    def submit(self, job: Job, owner: str, csv_content: bytes | None = None) -> RunRecord:
        with self._lock:
            if self._closed:
                raise ApiError("capacity_busy", "The server is shutting down.", retry_after=30)
            self._purge()
            busy = not self._can_start(provider_of(job))
            if busy and len(self._queue) >= self.settings.queue_size:
                raise ApiError(
                    "capacity_busy",
                    "The server is busy with other runs; try again shortly.",
                    retry_after=CAPACITY_RETRY_SECONDS,
                )
            self.quota.acquire(owner)
            record = RunRecord(
                run_id=uuid.uuid4().hex,
                owner=owner,
                job=job,
                csv_content=csv_content,
                created_at=datetime.now(UTC),
            )
            self._records[record.run_id] = record
            if busy:
                self._queue.append(record.run_id)
            else:
                self._start(record)
            return record

    def get(self, run_id: str) -> RunRecord | None:
        with self._lock:
            self._purge()
            return self._records.get(run_id)

    def cancel(self, run_id: str) -> RunRecord | None:
        with self._lock:
            record = self._records.get(run_id)
            if record is None:
                return None
            if record.status == "queued":
                self._queue.remove(run_id)
                self._fail(record, "cancelled", "run_cancelled", "The run was cancelled.", None)
                self.quota.release(record.owner)
                return record
        record.cancel.set()
        return record

    def events_since(self, record: RunRecord, seq: int) -> tuple[list[RunEvent], bool]:
        with record.lock:
            return record.events[seq:], record.finished

    def subscribe(self, record: RunRecord) -> bool:
        with record.lock:
            if record.subscribers >= self.settings.max_subscribers_per_run:
                return False
            record.subscribers += 1
            return True

    def unsubscribe(self, record: RunRecord) -> None:
        with record.lock:
            record.subscribers = max(0, record.subscribers - 1)

    def compressed_result(self, record: RunRecord) -> bytes | None:
        with record.lock:
            if record.result is None:
                return None
            if record.result_gzip is None:
                record.result_gzip = gzip.compress(record.result, GZIP_LEVEL)
            return record.result_gzip

    def counts(self) -> dict[str, int]:
        with self._lock:
            return {
                "running": len(self._threads),
                "queued": len(self._queue),
                "retained": len(self._records),
            }

    def live_processes(self) -> int:
        with self._lock:
            return sum(1 for process in self._processes.values() if process.is_alive())

    def live_spares(self) -> int:
        with self._spare_lock:
            return sum(1 for spare in self._spares if spare.process.is_alive())

    def ready_spares(self) -> int:
        with self._spare_lock:
            return sum(1 for spare in self._spares if spare.poll_ready())

    def spare_pids(self) -> list[int]:
        with self._spare_lock:
            return [spare.process.pid for spare in self._spares if spare.process.pid is not None]

    def purge(self) -> None:
        with self._lock:
            self._purge()

    def shutdown(self) -> None:
        with self._lock:
            self._closed = True
            for run_id in list(self._queue):
                record = self._records[run_id]
                self._fail(record, "cancelled", "run_cancelled", "The server stopped.", None)
                self.quota.release(record.owner)
            self._queue.clear()
            threads = list(self._threads.values())
            for run_id in self._threads:
                self._records[run_id].cancel.set()
            keeper = self._keeper
        self._keeper_stop.set()
        self._keeper_wake.set()
        if keeper is not None:
            keeper.join(JOIN_SECONDS * 2)
        with self._spare_lock:
            spares, self._spares = self._spares, []
        for spare in spares:
            self._discard(spare)
        for thread in threads:
            thread.join(JOIN_SECONDS * 2)

    def _purge(self) -> None:
        now = self.clock()
        ttl = self.settings.retention_minutes * 60
        for run_id, record in list(self._records.items()):
            if record.finished_clock is not None and now - record.finished_clock >= ttl:
                del self._records[run_id]
        excess = len(self._records) - self.settings.max_retained_runs
        for run_id, record in list(self._records.items()):
            if excess <= 0:
                break
            if record.finished:
                del self._records[run_id]
                excess -= 1

    def _can_start(self, provider: str | None) -> bool:
        if len(self._threads) >= self.settings.max_concurrent_runs:
            return False
        if provider in RATE_LIMITED_PROVIDERS:
            return self._providers[provider] < self.settings.runs_per_rate_limited_provider
        return True

    def _start(self, record: RunRecord) -> None:
        record.provider = provider_of(record.job)
        if record.provider is not None:
            self._providers[record.provider] += 1
        record.status = "running"
        record.stage = "DATA"
        record.started_at = datetime.now(UTC)
        thread = threading.Thread(
            target=self._supervise, args=(record,), name=f"run-{record.run_id[:8]}", daemon=True
        )
        self._threads[record.run_id] = thread
        thread.start()

    def _append(self, record: RunRecord, payload: dict[str, Any]) -> None:
        with record.lock:
            event = run_event_adapter.validate_python(
                {
                    "ts": datetime.now(UTC),
                    **payload,
                    "run_id": record.run_id,
                    "seq": len(record.events),
                }
            )
            record.events.append(event)
            if event.type == "stage_started":
                record.stage = event.stage
            elif event.type == "run_done":
                record.verdict = event.verdict

    def _fail(
        self,
        record: RunRecord,
        status: RunStatus,
        code: str,
        message: str,
        details: Any,
        stage: str | None = None,
    ) -> None:
        stage = stage or record.stage or "DATA"
        self._append(
            record, {"type": "run_failed", "stage": stage, "message": message, "code": code}
        )
        with record.lock:
            record.error = {"code": code, "message": message, "stage": stage, "details": details}
            self._finish(record, status)

    def _finish(self, record: RunRecord, status: RunStatus) -> None:
        record.status = status
        record.finished_at = datetime.now(UTC)
        record.finished_clock = self.clock()
        record.job = None
        record.csv_content = None

    def _keep(self) -> None:
        while not self._keeper_stop.is_set():
            self._replenish()
            self._keeper_wake.wait(KEEPER_SECONDS)
            self._keeper_wake.clear()

    def _replenish(self) -> None:
        with self._spare_lock:
            dead = [spare for spare in self._spares if not spare.process.is_alive()]
            self._spares = [spare for spare in self._spares if spare.process.is_alive()]
            missing = self.settings.warm_spares - len(self._spares)
        for spare in dead:
            self._discard(spare)
        for _ in range(missing):
            if self._keeper_stop.is_set():
                return
            spare = self._spawn_spare()
            with self._spare_lock:
                if self._keeper_stop.is_set():
                    self._discard(spare)
                    return
                self._spares.append(spare)

    def _spawn_spare(self) -> Spare:
        parent, child = self.context.Pipe(duplex=True)
        process = self.context.Process(
            target=spare_child, args=(child, self.target), name="mycelium-spare", daemon=True
        )
        process.start()
        child.close()
        return Spare(process, parent)

    def _discard(self, spare: Spare) -> None:
        if spare.process.is_alive():
            spare.process.kill()
        spare.process.join(JOIN_SECONDS)
        spare.connection.close()

    def _take_spare(self, message: tuple) -> Spare | None:
        while True:
            with self._spare_lock:
                if not self._spares:
                    return None
                spare = self._spares.pop(0)
            self._keeper_wake.set()
            if not spare.process.is_alive():
                self._discard(spare)
                continue
            try:
                spare.connection.send(message)
            except (EOFError, OSError):
                self._discard(spare)
                continue
            return spare

    def _spawn(self, record: RunRecord):
        message = (record.run_id, record.job, self.settings.model_dump(), record.csv_content)
        record.csv_content = None
        spare = self._take_spare(message)
        if spare is not None:
            with self._lock:
                self._processes[record.run_id] = spare.process
            return spare.connection, spare.process
        receiver, sender = self.context.Pipe(duplex=False)
        process = self.context.Process(
            target=self.target,
            args=(sender, *message),
            name=f"mycelium-run-{record.run_id[:8]}",
            daemon=True,
        )
        with self._lock:
            self._processes[record.run_id] = process
        process.start()
        sender.close()
        return receiver, process

    def _pump(self, record: RunRecord, receiver, process) -> Outcome:
        deadline = self.clock() + self.settings.run_timeout_seconds
        while True:
            if record.cancel.is_set():
                return Outcome("cancelled")
            remaining = deadline - self.clock()
            if remaining <= 0:
                return Outcome("timeout")
            if not receiver.poll(min(POLL_SECONDS, remaining)):
                if not process.is_alive() and not receiver.poll(0):
                    return Outcome("crashed")
                continue
            try:
                kind, value = receiver.recv()
            except (EOFError, OSError):
                return Outcome("crashed")
            if kind == "event":
                self._append(record, value)
            elif kind == "result":
                with record.lock:
                    record.result = value
            elif kind == "failed":
                return Outcome("failed", value)
            elif kind == "finished":
                return Outcome("done")

    def _supervise(self, record: RunRecord) -> None:
        receiver = process = None
        try:
            receiver, process = self._spawn(record)
            outcome = self._pump(record, receiver, process)
        except ValidationError:
            logger.error("run %s: the worker sent an event outside the contract", record.run_id)
            outcome = Outcome("crashed")
        except Exception as error:
            logger.error(
                "run %s: supervisor error %s", record.run_id, type(error).__name__, exc_info=True
            )
            outcome = Outcome("crashed")
        finally:
            if process is not None:
                if process.is_alive():
                    process.kill()
                process.join(JOIN_SECONDS)
            if receiver is not None:
                receiver.close()
        self._conclude(record, outcome)

    def _conclude(self, record: RunRecord, outcome: Outcome) -> None:
        timeout = self.settings.run_timeout_seconds
        if outcome.kind == "done":
            with record.lock:
                self._finish(record, "done")
        elif outcome.kind == "failed":
            failure = outcome.failure or {}
            self._fail(
                record,
                "failed",
                failure.get("code", "internal_error"),
                failure.get("message", "The run failed."),
                failure.get("details"),
                failure.get("stage"),
            )
        elif outcome.kind == "timeout":
            self._fail(
                record,
                "failed",
                "run_timeout",
                f"The run went over the {timeout:g}-second limit and was stopped.",
                None,
            )
        elif outcome.kind == "cancelled":
            self._fail(record, "cancelled", "run_cancelled", "The run was cancelled.", None)
        else:
            logger.error("run %s: the worker stopped without a result", record.run_id)
            self._fail(record, "failed", "internal_error", "The run stopped unexpectedly.", None)
        with self._lock:
            self._threads.pop(record.run_id, None)
            self._processes.pop(record.run_id, None)
            if record.provider is not None:
                self._providers[record.provider] -= 1
            self.quota.release(record.owner)
            self._start_queued()

    def _start_queued(self) -> None:
        if self._closed:
            return
        for run_id in list(self._queue):
            if len(self._threads) >= self.settings.max_concurrent_runs:
                return
            queued = self._records[run_id]
            if self._can_start(provider_of(queued.job)):
                self._queue.remove(run_id)
                self._start(queued)
