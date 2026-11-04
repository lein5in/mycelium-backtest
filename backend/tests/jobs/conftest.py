import time

import pytest

from app.jobs.manager import JobManager
from tests.api_helpers import settings
from tests.jobs.children import quick_child


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
        assert manager.live_spares() == 0
