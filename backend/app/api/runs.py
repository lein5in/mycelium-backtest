import asyncio
import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, ValidationError

from app.api.errors import NO_STORE, ErrorBody
from app.api.multipart import Part, parse
from app.data.csv_import import CsvOptions, CsvReport, import_csv
from app.data.models import SourceDescriptor
from app.engine.bars import Timeframe
from app.errors import ApiError, classify, field_problems
from app.jobs.manager import JobManager, RunRecord, RunStatus
from app.jobs.pipeline import RunResultPayload
from app.jobs.requests import CsvRunOptions, RunRequest, csv_job, provider_job
from app.runs.events import Stage
from app.runs.stream import HEARTBEAT, format_sse

router = APIRouter(prefix="/api")

SSE_HEADERS = {"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"}
STREAM_POLL_SECONDS = 0.1
ERRORS = {code: {"model": ErrorBody} for code in (400, 404, 409, 413, 415, 422, 429, 500, 503, 504)}
MULTIPART_CSV_SCHEMA = {
    "requestBody": {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "required": ["file"],
                    "properties": {
                        "file": {"type": "string", "format": "binary"},
                        "timezone": {"type": "string"},
                        "columns": {"type": "string", "description": "JSON object role -> header"},
                        "options": {"type": "string", "description": "JSON"},
                    },
                }
            }
        },
    }
}


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RunCreated(Frozen):
    run_id: str
    status: RunStatus
    events_url: str
    status_url: str
    result_url: str


class RunError(Frozen):
    code: str
    message: str
    stage: str | None
    details: object = None


class RunStatusDocument(Frozen):
    run_id: str
    status: RunStatus
    stage: Stage | None
    verdict: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    events: int
    error: RunError | None
    events_url: str
    result_url: str


class CsvPreview(Frozen):
    ok: bool
    report: CsvReport
    bar_count: int | None
    timeframe: Timeframe | None
    start: datetime | None
    end: datetime | None
    source: SourceDescriptor | None
    note: str = "The file is processed in memory to produce this preview and is not kept."


def manager_of(request: Request) -> JobManager:
    return request.app.state.jobs


def client_key(request: Request) -> str:
    return str(request.scope.get("state", {}).get("client_key", "unknown"))


def record_or_404(request: Request, run_id: str) -> RunRecord:
    record = manager_of(request).get(run_id) if len(run_id) <= 64 else None
    if record is None:
        raise ApiError("run_not_found", "This run does not exist or has expired.")
    return record


def created(record: RunRecord) -> RunCreated:
    base = f"/api/runs/{record.run_id}"
    return RunCreated(
        run_id=record.run_id,
        status=record.status,
        events_url=f"{base}/events",
        status_url=base,
        result_url=f"{base}/result",
    )


def status_document(record: RunRecord) -> RunStatusDocument:
    with record.lock:
        base = f"/api/runs/{record.run_id}"
        return RunStatusDocument(
            run_id=record.run_id,
            status=record.status,
            stage=record.stage,
            verdict=record.verdict,
            created_at=record.created_at,
            started_at=record.started_at,
            finished_at=record.finished_at,
            events=len(record.events),
            error=RunError(**record.error) if record.error else None,
            events_url=f"{base}/events",
            result_url=f"{base}/result",
        )


def json_part(parts: dict[str, Part], name: str) -> object:
    part = parts.get(name)
    if part is None:
        return None
    try:
        return json.loads(part.text())
    except json.JSONDecodeError as error:
        raise ApiError(
            "invalid_request",
            f"The form field {name!r} is not valid JSON.",
            details={"problems": [{"field": name, "message": "not valid JSON"}]},
        ) from error


async def read_form(request: Request) -> dict[str, Part]:
    body = await request.body()
    return parse(body, request.headers.get("content-type", ""))


def csv_file(request: Request, parts: dict[str, Part]) -> bytes:
    part = parts.get("file")
    if part is None or part.filename is None:
        raise ApiError(
            "invalid_request",
            "Attach the CSV file in the form field 'file'.",
            details={"problems": [{"field": "file", "message": "missing"}]},
        )
    limit = request.app.state.settings.max_csv_bytes
    if len(part.data) > limit:
        raise ApiError(
            "file_too_large", f"The file is larger than the {limit / 1048576:g} MB limit."
        )
    if not part.data:
        raise ApiError("csv_invalid", "The file is empty.")
    return part.data


def csv_overrides(parts: dict[str, Part], base: dict) -> dict:
    values = dict(base)
    if "timezone" in parts:
        values["timezone"] = parts["timezone"].text().strip() or None
    columns = json_part(parts, "columns")
    if columns is not None:
        values["columns"] = columns
    return values


def validated(model: type[BaseModel], value: object, field: str):
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise ApiError(
            "invalid_request",
            "The request is not valid.",
            details={"problems": field_problems(error, (field,))},
        ) from error


@router.post("/csv/preview", openapi_extra=MULTIPART_CSV_SCHEMA, responses=ERRORS)
async def preview_csv(request: Request) -> CsvPreview:
    parts = await read_form(request)
    content = csv_file(request, parts)
    raw_options = json_part(parts, "options") or {}
    if not isinstance(raw_options, dict):
        raise ApiError("invalid_request", "The form field 'options' must be a JSON object.")
    options = validated(CsvOptions, csv_overrides(parts, raw_options), "options")
    try:
        data, report = await run_in_threadpool(import_csv, content, options)
    except Exception as error:
        api_error = classify(error, "DATA")
        if api_error.code != "csv_invalid":
            raise api_error from error
        report = CsvReport.model_validate(api_error.details["csv_report"])
        return CsvPreview(
            ok=False,
            report=report,
            bar_count=None,
            timeframe=None,
            start=None,
            end=None,
            source=None,
        )
    finally:
        del content
    return CsvPreview(
        ok=True,
        report=report,
        bar_count=data.bars.size,
        timeframe=data.source.timeframe,
        start=data.source.start,
        end=data.source.end,
        source=data.source,
    )


@router.post("/runs", status_code=status.HTTP_201_CREATED, responses=ERRORS)
def create_run(request: Request, body: RunRequest, response: Response) -> RunCreated:
    job = provider_job(body, request.app.state.providers)
    record = manager_of(request).submit(job, client_key(request))
    response.headers.update(NO_STORE)
    return created(record)


@router.post(
    "/runs/csv",
    status_code=status.HTTP_201_CREATED,
    openapi_extra=MULTIPART_CSV_SCHEMA,
    responses=ERRORS,
)
async def create_csv_run(request: Request, response: Response) -> RunCreated:
    parts = await read_form(request)
    content = csv_file(request, parts)
    raw_options = json_part(parts, "options") or {}
    if not isinstance(raw_options, dict):
        raise ApiError("invalid_request", "The form field 'options' must be a JSON object.")
    raw_options = {**raw_options, "csv": csv_overrides(parts, raw_options.get("csv") or {})}
    options = validated(CsvRunOptions, raw_options, "options")
    job = csv_job(options)
    record = manager_of(request).submit(job, client_key(request), content)
    del content, parts
    response.headers.update(NO_STORE)
    return created(record)


@router.get("/runs/{run_id}", responses=ERRORS)
def run_status(request: Request, run_id: str, response: Response) -> RunStatusDocument:
    response.headers.update(NO_STORE)
    return status_document(record_or_404(request, run_id))


@router.delete("/runs/{run_id}", responses=ERRORS)
def cancel_run(request: Request, run_id: str, response: Response) -> RunStatusDocument:
    record = record_or_404(request, run_id)
    manager_of(request).cancel(run_id)
    response.headers.update(NO_STORE)
    return status_document(record)


@router.get(
    "/runs/{run_id}/result",
    responses={**ERRORS, 200: {"model": RunResultPayload}},
    response_class=Response,
)
def run_result(request: Request, run_id: str) -> Response:
    record = record_or_404(request, run_id)
    with record.lock:
        state, error, body = record.status, record.error, record.result
    if state == "cancelled":
        raise ApiError("run_cancelled", "The run was cancelled; it has no result.")
    if state == "failed" and error:
        raise ApiError(error["code"], error["message"], error.get("stage"), error.get("details"))
    if state != "done" or body is None:
        raise ApiError(
            "run_not_finished",
            "The run has not finished yet; wait for run_done on the event stream.",
        )
    headers = {**NO_STORE, "Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", "").lower():
        compressed = manager_of(request).compressed_result(record)
        if compressed is not None:
            headers["Content-Encoding"] = "gzip"
            return Response(compressed, media_type="application/json", headers=headers)
    return Response(body, media_type="application/json", headers=headers)


def resume_after(last_event_id: str | None, query_value: int | None) -> int:
    if query_value is not None:
        return query_value
    if last_event_id is None or not last_event_id.strip():
        return -1
    try:
        return max(-1, int(last_event_id.strip()))
    except ValueError as error:
        raise ApiError(
            "invalid_request", "Last-Event-ID must be an event sequence number."
        ) from error


@router.get(
    "/runs/{run_id}/events",
    response_class=StreamingResponse,
    responses={**ERRORS, 200: {"content": {"text/event-stream": {}}}},
)
async def run_events(
    request: Request,
    run_id: str,
    last_event_id: Annotated[str | None, Header()] = None,
    after: Annotated[int | None, Query(ge=-1, le=1_000_000)] = None,
) -> StreamingResponse:
    record = record_or_404(request, run_id)
    manager = manager_of(request)
    cursor = resume_after(last_event_id, after) + 1
    if not manager.subscribe(record):
        raise ApiError("rate_limited", "Too many open streams for this run.", retry_after=5)
    heartbeat = request.app.state.settings.heartbeat_seconds
    return StreamingResponse(
        stream(manager, record, cursor, heartbeat, request),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def stream(manager: JobManager, record: RunRecord, cursor: int, heartbeat: float, request):
    loop = asyncio.get_running_loop()
    quiet_since = loop.time()
    try:
        while True:
            events, finished = manager.events_since(record, cursor)
            for event in events:
                yield format_sse(event)
            if events:
                cursor += len(events)
                quiet_since = loop.time()
                continue
            if finished:
                return
            if await request.is_disconnected():
                return
            if loop.time() - quiet_since >= heartbeat:
                yield HEARTBEAT
                quiet_since = loop.time()
            await asyncio.sleep(STREAM_POLL_SECONDS)
    finally:
        manager.unsubscribe(record)
