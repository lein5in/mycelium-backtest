from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from app.honesty.config import HonestyConfig
from app.runs.events import CheckId, CheckStatus, Verdict

REPORT_SCHEMA_VERSION = 1

Scalar = float | int | bool | str | None
Headline = Annotated[str, Field(min_length=1, max_length=120)]
PartStatus = Literal["PASS", "WARN", "FAIL", "not_run"]
STATUS_RANK: dict[str, int] = {"PASS": 0, "WARN": 1, "FAIL": 2}


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CheckResult(Frozen):
    id: CheckId
    status: CheckStatus
    headline: Headline
    detail: str
    insufficient_data: bool
    measured: dict[str, Scalar]
    thresholds: dict[str, float | int]


def settle(status: CheckStatus, insufficient: bool) -> CheckStatus:
    return "WARN" if insufficient and status == "PASS" else status


def worse(first: CheckStatus, second: CheckStatus) -> CheckStatus:
    return first if STATUS_RANK[first] >= STATUS_RANK[second] else second


class PeriodBlock(Frozen):
    index: int
    first_trade: int
    last_trade: int
    trade_count: int
    start: datetime | None
    end: datetime | None
    net_pnl: float
    share_of_profit: float | None


class PeriodPart(Frozen):
    status: CheckStatus
    insufficient_data: bool
    blocks: list[PeriodBlock]
    max_share: float | None
    positive_fraction: float | None
    total_net_pnl: float


class Histogram(Frozen):
    edges: list[float]
    counts: list[int]
    real_value: float
    real_bin: int


class RandomEntries(Frozen):
    draws: int
    seed: int
    trades_per_draw: int
    eligible_entry_bars: int
    real_net_pnl: float
    percentile: float | None
    mean: float | None
    median: float | None
    p5: float | None
    p95: float | None
    histogram: Histogram | None


class SweepAxis(Frozen):
    name: str
    label: str
    values: list[float]
    chosen: float


CellState = Literal["ok", "invalid", "not_run"]


class SweepCell(Frozen):
    coordinates: list[int]
    values: dict[str, float]
    state: CellState
    net_pnl: float | None
    profit_factor: float | None
    trade_count: int | None
    message: str | None = None


class SweepResult(Frozen):
    axes: list[SweepAxis]
    cells: list[SweepCell]
    chosen: list[int]
    best: list[int] | None
    combinations: int
    completed: int
    stopped_by_budget: bool
    elapsed_seconds: float
    neighbour_count: int
    profitable_neighbour_fraction: float | None
    neighbour_median_share: float | None
    chosen_is_spike: bool
    best_is_spike: bool


class ParameterPart(Frozen):
    status: PartStatus
    insufficient_data: bool
    reason: str


class Robustness(Frozen):
    period: PeriodPart
    parameters: ParameterPart


class VerdictRule(Frozen):
    id: str
    verdict: Verdict
    description: str
    matched: bool


class VerdictResult(Frozen):
    id: Verdict
    label: str
    rule: str
    sentence: str
    rules: list[VerdictRule]


DayKind = Literal["session", "closed", "no_data", "other_month"]


class CalendarDay(Frozen):
    date: date
    kind: DayKind
    net_pnl: float | None
    trades: int | None


class CalendarWeek(Frozen):
    monday: date
    days: list[CalendarDay]
    net_pnl: float
    trades: int


class CalendarMonth(Frozen):
    month: Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
    weeks: list[CalendarWeek]
    net_pnl: float
    trades: int
    green_weeks: int
    weeks_with_trades: int
    best_day: date | None
    best_day_pnl: float | None
    worst_day: date | None
    worst_day_pnl: float | None


class PnlCalendar(Frozen):
    rule: str
    timezone: str
    months: list[CalendarMonth]


class RunSummary(Frozen):
    strategy_id: str
    strategy_name: str
    parameters: dict[str, JsonValue]
    market: str
    timeframe: str
    first_bar: datetime
    last_bar: datetime
    bar_count: int
    trade_count: int


class HonestyReport(Frozen):
    schema_version: Literal[1] = REPORT_SCHEMA_VERSION
    run: RunSummary
    checks: list[CheckResult]
    verdict: VerdictResult
    config: HonestyConfig
    random_entries: RandomEntries
    robustness: Robustness
    sweep: SweepResult | None
    calendar: PnlCalendar
    assumptions: list[str]
