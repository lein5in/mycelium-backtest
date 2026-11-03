import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Iterator
from datetime import UTC, datetime, timedelta

from app.runs.events import RunEvent, run_event_adapter
from app.runs.scenario import Step

HEARTBEAT = ": heartbeat\n\n"


def materialise(
    steps: Iterable[Step], run_id: str, started_at: datetime
) -> Iterator[tuple[float, RunEvent]]:
    elapsed = 0.0
    for seq, step in enumerate(steps):
        elapsed += step.delay
        event = run_event_adapter.validate_python(
            {
                **step.payload,
                "run_id": run_id,
                "seq": seq,
                "ts": started_at + timedelta(seconds=elapsed),
            }
        )
        yield step.delay, event


def format_sse(event: RunEvent) -> str:
    return f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"


async def stream_events(
    steps: Iterable[Step],
    run_id: str,
    speed: float,
    heartbeat_seconds: float,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    deadline = loop.time()
    for delay, event in materialise(steps, run_id, datetime.now(UTC)):
        deadline += delay / speed
        while (remaining := deadline - loop.time()) > 0:
            await asyncio.sleep(min(remaining, heartbeat_seconds))
            if await is_disconnected():
                return
            if loop.time() < deadline:
                yield HEARTBEAT
        if await is_disconnected():
            return
        yield format_sse(event.model_copy(update={"ts": datetime.now(UTC)}))
