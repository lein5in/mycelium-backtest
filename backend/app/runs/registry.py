import uuid
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

from app.runs.scenario import Scenario


@dataclass(frozen=True)
class FakeRun:
    run_id: str
    scenario: Scenario
    speed: float


class RunRegistry:
    def __init__(self, capacity: int = 256) -> None:
        self._capacity = capacity
        self._runs: OrderedDict[str, FakeRun] = OrderedDict()
        self._lock = Lock()

    def create(self, scenario: Scenario, speed: float) -> FakeRun:
        run = FakeRun(run_id=uuid.uuid4().hex, scenario=scenario, speed=speed)
        with self._lock:
            self._runs[run.run_id] = run
            while len(self._runs) > self._capacity:
                self._runs.popitem(last=False)
        return run

    def get(self, run_id: str) -> FakeRun | None:
        with self._lock:
            return self._runs.get(run_id)
