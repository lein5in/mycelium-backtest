from typing import Annotated

from fastapi import APIRouter, Body, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.errors import ApiError
from app.runs.registry import RunRegistry
from app.runs.scenario import Scenario, scripted_steps
from app.runs.stream import stream_events

router = APIRouter(prefix="/api/dev/fake-runs", include_in_schema=False)

SSE_HEADERS = {
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
}


class CreateFakeRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: Scenario = Scenario.SUCCESS
    speed: Annotated[float, Field(gt=0, le=1000)] = 1.0


class CreateFakeRunResponse(BaseModel):
    run_id: str
    events_url: str


def _registry(request: Request) -> RunRegistry:
    return request.app.state.run_registry


@router.post("", status_code=status.HTTP_201_CREATED)
def create_fake_run(
    request: Request, body: Annotated[CreateFakeRunRequest | None, Body()] = None
) -> CreateFakeRunResponse:
    spec = body or CreateFakeRunRequest()
    run = _registry(request).create(spec.scenario, spec.speed)
    return CreateFakeRunResponse(
        run_id=run.run_id, events_url=f"/api/dev/fake-runs/{run.run_id}/events"
    )


@router.get("/{run_id}/events")
def fake_run_events(run_id: str, request: Request) -> StreamingResponse:
    run = _registry(request).get(run_id)
    if run is None:
        raise ApiError("run_not_found", "This run does not exist or has expired.")
    stream = stream_events(
        scripted_steps(run.scenario),
        run.run_id,
        run.speed,
        request.app.state.settings.heartbeat_seconds,
        request.is_disconnected,
    )
    return StreamingResponse(stream, media_type="text/event-stream", headers=SSE_HEADERS)
