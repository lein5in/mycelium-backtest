import gzip
import logging
import multiprocessing
import threading
import time
import uuid
from collections import OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import ValidationError

from app.config import Settings
from app.errors import ApiError
from app.jobs.limits import Clock, RunQuota
from app.jobs.requests import Job
from app.jobs.worker import run_child
from app.runs.events import RunEvent, Stage, run_event_adapter

logger = logging.getLogger("mycelium.jobs")

RunStatus = Literal["queued", "running", "done", "failed", "cancelled"]
TERMINAL: frozenset[str] = frozenset({"done", "failed", "cancelled"})
POLL_SECONDS = 0.05
JOIN_SECONDS = 5.0
CAPACITY_RETRY_SECONDS = 15
GZIP_LEVEL = 6
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
    cancel: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def finished(self) -> bool:
        return self.status in TERMINAL


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
        self._lock = threading.Lock()
        self._closed = False

    def submit(self, job: Job, owner: str, csv_content: bytes | None = None) -> RunRecord:
        with self._lock:
            if self._closed:
                raise ApiError("capacity_busy", "The server is shutting down.", retry_after=30)
            self._purge()
            busy = len(self._threads) >= self.settings.max_concurrent_runs
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

    def _start(self, record: RunRecord) -> None:
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

    def _spawn(self, record: RunRecord):
        receiver, sender = self.context.Pipe(duplex=False)
        process = self.context.Process(
            target=self.target,
            args=(
                sender,
                record.run_id,
                record.job,
                self.settings.model_dump(),
                record.csv_content,
            ),
            name=f"mycelium-run-{record.run_id[:8]}",
            daemon=True,
        )
        record.csv_content = None
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
            self.quota.release(record.owner)
            while (
                self._queue
                and not self._closed
                and len(self._threads) < self.settings.max_concurrent_runs
            ):
                self._start(self._records[self._queue.popleft()])
