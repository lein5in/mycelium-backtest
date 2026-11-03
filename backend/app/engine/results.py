from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

RESULT_SCHEMA_VERSION = 1

Side = Literal["long", "short"]
ExitReason = Literal["stop", "target", "time_exit", "exit_signal", "risk_limit", "end_of_data"]
EXIT_REASONS: tuple[ExitReason, ...] = (
    "stop",
    "target",
    "time_exit",
    "exit_signal",
    "risk_limit",
    "end_of_data",
)
FillPoint = Literal["open", "intrabar", "close"]


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Trade(Frozen):
    side: Side
    signal_index: int
    entry_index: int
    exit_index: int
    signal_time: datetime
    entry_time: datetime
    exit_time: datetime
    exit_fill: FillPoint
    session: date
    exit_session: date
    quantity: float
    entry_price: float
    exit_price: float
    stop_price: float
    target_price: float | None
    exit_reason: ExitReason
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    bars_held: int


class DailyEquity(Frozen):
    session: date
    equity: float
    drawdown_pct: float


class Halt(Frozen):
    reason: Literal["max_drawdown"]
    bar_index: int
    time: datetime
    drawdown_pct: float


class TradeSummary(Frozen):
    trade_count: int
    net_pnl: float
    return_pct: float
    win_rate_pct: float | None
    average_win: float | None
    average_loss: float | None
    expectancy: float | None
    profit_factor: float | None
    longest_losing_streak: int
    realised_max_drawdown_pct: float
    realised_max_drawdown: float


class Metrics(Frozen):
    summary: TradeSummary
    initial_capital: float
    final_equity: float
    max_drawdown_pct: float
    max_drawdown: float
    exposure_pct: float
    sharpe: float | None
    cagr_pct: float | None
    annual_volatility_pct: float | None
    annualisation_days: int
    period_days: float


class CalendarBucket(Frozen):
    period: str
    net_pnl: float
    trades: int


class Calendar(Frozen):
    days: list[CalendarBucket]
    weeks: list[CalendarBucket]
    months: list[CalendarBucket]


class Diagnostics(Frozen):
    signals: int
    entries: int
    skipped: dict[str, int]


class RunResult(Frozen):
    schema_version: Literal[1] = RESULT_SCHEMA_VERSION
    strategy: str
    market: str
    timeframe: str
    bar_count: int
    first_bar: datetime
    last_bar: datetime
    warmup_bars: int
    trades: list[Trade]
    daily_equity: list[DailyEquity]
    metrics: Metrics
    calendar: Calendar
    halted: Halt | None
    diagnostics: Diagnostics
    assumptions: list[str]
