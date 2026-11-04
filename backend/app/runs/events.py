from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.error_codes import ErrorCode

SCHEMA_VERSION = 2

Stage = Literal["DATA", "SIGNALS", "SIMULATOR", "COSTS", "AUDITOR", "REPORTER"]
STAGES: tuple[Stage, ...] = ("DATA", "SIGNALS", "SIMULATOR", "COSTS", "AUDITOR", "REPORTER")

CheckId = Literal[
    "costs",
    "trade_count",
    "without_best_trade",
    "out_of_sample",
    "versus_random",
    "robustness",
]
CHECK_IDS: tuple[CheckId, ...] = (
    "costs",
    "trade_count",
    "without_best_trade",
    "out_of_sample",
    "versus_random",
    "robustness",
)

CheckStatus = Literal["PASS", "WARN", "FAIL"]
Verdict = Literal["CREDIBLE", "FRAGILE", "NOT_CREDIBLE"]

Detail = Annotated[str, Field(max_length=120)]


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[2] = SCHEMA_VERSION
    run_id: Annotated[str, Field(min_length=1, max_length=64)]
    seq: Annotated[int, Field(ge=0)]
    ts: datetime


class RunStarted(EventEnvelope):
    type: Literal["run_started"] = "run_started"
    bar_count: Annotated[int, Field(ge=1)]


class StageStarted(EventEnvelope):
    type: Literal["stage_started"] = "stage_started"
    stage: Stage


class StageProgress(EventEnvelope):
    type: Literal["stage_progress"] = "stage_progress"
    stage: Stage
    progress: Annotated[int, Field(ge=0, le=100)]
    detail: Detail | None = None
    bar_index: Annotated[int, Field(ge=0)] | None = None


class StageDone(EventEnvelope):
    type: Literal["stage_done"] = "stage_done"
    stage: Stage
    detail: Detail | None = None


class ClusterRegion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start_bar: Annotated[int, Field(ge=0)]
    end_bar: Annotated[int, Field(ge=0)]
    price_low: Annotated[float, Field(ge=0, le=1)]
    price_high: Annotated[float, Field(ge=0, le=1)]

    @model_validator(mode="after")
    def ordered(self) -> "ClusterRegion":
        if self.end_bar < self.start_bar:
            raise ValueError("end_bar must not precede start_bar")
        if self.price_high < self.price_low:
            raise ValueError("price_high must not be below price_low")
        return self


class TradeCluster(EventEnvelope):
    type: Literal["trade_cluster"] = "trade_cluster"
    region: ClusterRegion
    fills: Annotated[int, Field(ge=1)]
    net_result: float


class CheckDone(EventEnvelope):
    type: Literal["check_done"] = "check_done"
    check_id: CheckId
    status: CheckStatus
    figure: Detail


class RunDone(EventEnvelope):
    type: Literal["run_done"] = "run_done"
    verdict: Verdict


class RunFailed(EventEnvelope):
    type: Literal["run_failed"] = "run_failed"
    stage: Stage
    message: Annotated[str, Field(min_length=1, max_length=200)]
    code: ErrorCode | None = None


RunEvent = Annotated[
    RunStarted
    | StageStarted
    | StageProgress
    | StageDone
    | TradeCluster
    | CheckDone
    | RunDone
    | RunFailed,
    Field(discriminator="type"),
]

run_event_adapter: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)
run_event_list_adapter: TypeAdapter[list[RunEvent]] = TypeAdapter(list[RunEvent])


def run_event_json_schema() -> dict[str, object]:
    schema = run_event_adapter.json_schema()
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://mycelium-backtest/contracts/run_events.schema.json",
        "title": "RunEvent",
        "x-schema-version": SCHEMA_VERSION,
        **schema,
    }
