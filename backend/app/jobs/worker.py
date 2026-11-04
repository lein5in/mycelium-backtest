import logging
import sys
from collections.abc import Callable
from multiprocessing.connection import Connection
from typing import Any

from app.config import Settings
from app.data.registry import DataRegistry
from app.errors import ApiError, classify
from app.jobs.pipeline import RegistryFactory, Reporter, execute
from app.jobs.requests import Job

logger = logging.getLogger("mycelium.worker")

MEMORY_MESSAGE = "The run needed more memory than this server allows. Try a shorter range."


def apply_memory_limit(megabytes: int) -> bool:
    if megabytes <= 0 or not sys.platform.startswith("linux"):
        return False
    import resource

    limit = megabytes * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    return True


def failure(error: ApiError) -> dict[str, Any]:
    return {
        "code": error.code,
        "message": error.message,
        "stage": error.stage,
        "details": error.details,
    }


def warm_up() -> None:
    from app.engine.sessions import _nyse_arrays

    _nyse_arrays()


def spare_child(connection: Connection, target: Callable[..., None]) -> None:
    warm_up()
    connection.send(("ready", None))
    try:
        message = connection.recv()
    except (EOFError, OSError):
        return
    if message is None:
        return
    run_id, job, settings_values, csv_content = message
    target(connection, run_id, job, settings_values, csv_content)


def run_child(
    connection: Connection,
    run_id: str,
    job: Job,
    settings_values: dict[str, Any],
    csv_content: bytes | None,
    registry_factory: RegistryFactory = DataRegistry,
) -> None:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    settings = Settings(**settings_values)
    apply_memory_limit(settings.child_memory_mb)
    reporter = Reporter(lambda payload: connection.send(("event", payload)))
    try:
        body, verdict = execute(run_id, job, reporter, settings, csv_content, registry_factory)
        del csv_content
        connection.send(("result", body))
        reporter.done("report ready")
        reporter.send({"type": "run_done", "verdict": verdict})
        connection.send(("finished", None))
    except MemoryError:
        error = ApiError("internal_error", MEMORY_MESSAGE, reporter.stage)
        connection.send(("failed", failure(error)))
    except Exception as exc:
        error = classify(exc, reporter.stage)
        if error.code == "internal_error":
            logger.error(
                "run %s: unexpected %s at stage %s",
                run_id,
                type(exc).__name__,
                reporter.stage,
                exc_info=True,
            )
        error.stage = reporter.stage
        connection.send(("failed", failure(error)))
    finally:
        connection.close()
