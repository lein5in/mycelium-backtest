from typing import Annotated

from fastapi import APIRouter, Body, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.runs.registry import RunRegistry
from app.runs.scenario import Scenario, scripted_steps
from app.runs.stream import stream_events

router = APIRouter(prefix="/api/runs")

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: Scenario = Scenario.SUCCESS
    speed: Annotated[float, Field(gt=0, le=1000)] = 1.0


class CreateRunResponse(BaseModel):
    run_id: str
    events_url: str


def _registry(request: Request) -> RunRegistry:
    return request.app.state.run_registry


@router.post("", status_code=status.HTTP_201_CREATED)
def create_run(
    request: Request, body: Annotated[CreateRunRequest | None, Body()] = None
) -> CreateRunResponse:
    spec = body or CreateRunRequest()
    run = _registry(request).create(spec.scenario, spec.speed)
    return CreateRunResponse(run_id=run.run_id, events_url=f"/api/runs/{run.run_id}/events")


@router.get("/{run_id}/events")
def run_events(run_id: str, request: Request) -> StreamingResponse:
    run = _registry(request).get(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown run id")
    stream = stream_events(
        scripted_steps(run.scenario),
        run.run_id,
        run.speed,
        request.app.state.settings.heartbeat_seconds,
        request.is_disconnected,
    )
    return StreamingResponse(stream, media_type="text/event-stream", headers=SSE_HEADERS)
