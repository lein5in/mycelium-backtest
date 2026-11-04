import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, JsonValue

from app.config import Settings
from app.data.cache import CACHEABLE, CachedCandles, DiskCache
from app.data.csv_import import CsvReport, import_csv
from app.data.heatmap import HeatmapGrid, grid_from_candles
from app.data.models import DataResult, GapReport, SourceDescriptor
from app.data.registry import DataRegistry
from app.data.samples import PROVIDER as SAMPLES
from app.data.samples import fetch_sample
from app.engine.backtest import prepare_sessions, run_plan
from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig, FixedFraction, Instrument
from app.engine.results import RunResult
from app.engine.sessions import Crypto24x7Session, UsEquitySession
from app.engine.signals import SignalPlan, compile_spec
from app.engine.simulation import TradeRecord
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, HonestyReport
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.jobs.requests import CsvRunOptions, Job, RunRequest, default_risk
from app.runs.events import CHECK_IDS, Stage
from app.strategies.registry import build_spec

Emit = Callable[[dict[str, Any]], None]
RegistryFactory = Callable[[Settings], DataRegistry]

CLUSTER_WINDOWS = 10
SIMULATOR_STEP = 2
DETAIL_LIMIT = 120
COST_TOLERANCE = 1e-6
RESULT_SCHEMA_VERSION = 1


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BarColumns(Frozen):
    time: list[int]
    open: list[float]
    high: list[float]
    low: list[float]
    close: list[float]
    volume: list[float]


class Truncation(Frozen):
    bars_total: int
    bars_returned: int
    bars_first_index: int
    bars_truncated: bool
    trades_total: int
    trades_returned: int
    trades_truncated: bool
    note: str | None


class CostTotals(Frozen):
    fills: int
    fees: float
    slippage: float
    gross_pnl: float
    net_pnl: float


class RunResultPayload(Frozen):
    schema_version: int = RESULT_SCHEMA_VERSION
    run_id: str
    request: dict[str, JsonValue]
    source: SourceDescriptor
    gaps: GapReport
    data_warnings: list[str]
    csv_report: CsvReport | None
    result: RunResult
    report: HonestyReport
    heatmap: HeatmapGrid
    costs: CostTotals
    bars: BarColumns
    limits: Truncation


def clip(text: str) -> str:
    return text if len(text) <= DETAIL_LIMIT else text[: DETAIL_LIMIT - 1] + "…"


@dataclass
class Reporter:
    emit: Emit
    stage: Stage = "DATA"

    def send(self, payload: dict[str, Any]) -> None:
        self.emit({**payload, "ts": datetime.now(UTC).isoformat()})

    def start(self, stage: Stage) -> None:
        self.stage = stage
        self.send({"type": "stage_started", "stage": stage})

    def progress(self, percent: int, detail: str | None = None, bar_index: int | None = None):
        payload: dict[str, Any] = {
            "type": "stage_progress",
            "stage": self.stage,
            "progress": max(0, min(100, int(percent))),
            "detail": clip(detail) if detail else None,
        }
        if bar_index is not None:
            payload["bar_index"] = int(bar_index)
        self.send(payload)

    def done(self, detail: str | None = None) -> None:
        self.send(
            {"type": "stage_done", "stage": self.stage, "detail": clip(detail) if detail else None}
        )


@dataclass
class ClusterBuilder:
    bars: BarSeries
    reporter: Reporter
    window: int = 0
    gap: int = 0
    low: float = 0.0
    span: float = 1.0
    group: list[TradeRecord] = field(default_factory=list)
    emitted: int = 0
    seen: int = 0

    def __post_init__(self) -> None:
        self.window = max(1, math.ceil(self.bars.size / CLUSTER_WINDOWS))
        self.gap = max(1, self.window // 2)
        self.low = float(self.bars.low.min())
        self.span = max(float(self.bars.high.max()) - self.low, 1e-12)

    def fraction(self, price: float) -> float:
        return round(min(1.0, max(0.0, (price - self.low) / self.span)), 4)

    def belongs(self, trade: TradeRecord) -> bool:
        if not self.group:
            return True
        first = self.group[0]
        same_window = trade.entry_index // self.window == first.entry_index // self.window
        near = trade.entry_index - self.group[-1].exit_index <= self.gap
        return same_window and near

    def add(self, trades: Sequence[TradeRecord]) -> None:
        for trade in trades:
            self.seen += 1
            if not self.belongs(trade):
                self.flush()
            self.group.append(trade)

    def flush(self) -> None:
        if not self.group:
            return
        prices = [price for t in self.group for price in (t.entry_price, t.exit_price)]
        self.reporter.send(
            {
                "type": "trade_cluster",
                "region": {
                    "start_bar": min(t.entry_index for t in self.group),
                    "end_bar": max(t.exit_index for t in self.group),
                    "price_low": self.fraction(min(prices)),
                    "price_high": self.fraction(max(prices)),
                },
                "fills": 2 * len(self.group),
                "net_result": round(sum(t.net_pnl for t in self.group), 2),
            }
        )
        self.emitted += 1
        self.group = []


@dataclass(frozen=True)
class LoadedData:
    data: DataResult
    csv_report: CsvReport | None
    detail: str


def disk_cache(settings: Settings) -> DiskCache:
    return DiskCache(
        directory=settings.cache_dir,
        max_bytes=int(settings.cache_max_mb * 1024 * 1024),
        ttl_closed_seconds=settings.cache_ttl_closed_days * 86_400,
        ttl_live_seconds=settings.cache_ttl_live_seconds,
    )


def load_provider(
    request: RunRequest, settings: Settings, registry_factory: RegistryFactory = DataRegistry
) -> LoadedData:
    source = request.data
    if source.provider == SAMPLES:
        data = fetch_sample(source.symbol, source.timeframe, source.start, source.end)
        return LoadedData(data, None, f"{data.bars.size:,} bars generated · SAMPLE DATA")
    registry = registry_factory(settings)
    try:
        provider = registry.candles(source.provider)
        if provider.id in CACHEABLE:
            cache = disk_cache(settings)
            data = CachedCandles(provider, cache).fetch(
                source.symbol, source.timeframe, source.start, source.end
            )
            chunks = cache.stats.hits + cache.stats.misses
            detail = (
                f"{data.bars.size:,} bars · {chunks} chunk(s), {cache.stats.misses} fetched, "
                f"{cache.stats.hits} cached"
            )
        else:
            data = provider.fetch(source.symbol, source.timeframe, source.start, source.end)
            detail = f"{data.bars.size:,} bars fetched from {data.source.display_name}"
    finally:
        registry.close()
    return LoadedData(data, None, detail)


def load_csv(options: CsvRunOptions, content: bytes) -> LoadedData:
    data, report = import_csv(content, options.csv)
    return LoadedData(data, report, f"{report.rows:,} rows parsed · {data.bars.size:,} bars valid")


def backtest_config(job: Job) -> BacktestConfig:
    options = job.options
    if job.market == "crypto_24x7":
        anchor = options.session_anchor or (
            options.csv.anchor if isinstance(options, CsvRunOptions) else "00:00"
        )
        session: Crypto24x7Session | UsEquitySession = Crypto24x7Session(anchor=anchor)
    else:
        session = UsEquitySession()
    return BacktestConfig(
        session=session,
        instrument=Instrument(
            symbol=symbol_of(job)[:32],
            tick_size=options.tick_size,
            quantity_step=options.quantity_step,
        ),
        costs=options.costs,
        sizing=options.sizing or FixedFraction(),
        risk=options.risk or default_risk(options.strategy_id),
        initial_capital=options.initial_capital,
    )


def symbol_of(job: Job) -> str:
    options = job.options
    return options.data.symbol if isinstance(options, RunRequest) else options.csv.symbol


def signal_count(plan: SignalPlan) -> int:
    return sum(int(np.count_nonzero(side.entry)) for side in (plan.long, plan.short) if side)


def cost_totals(result: RunResult) -> CostTotals:
    fees = slippage = gross = net = 0.0
    for trade in result.trades:
        expected = trade.gross_pnl - trade.slippage_cost - trade.fees
        if abs(expected - trade.net_pnl) > COST_TOLERANCE * max(1.0, abs(trade.net_pnl)):
            raise ValueError("cost identity failed")
        fees += trade.fees
        slippage += trade.slippage_cost
        gross += trade.gross_pnl
        net += trade.net_pnl
    return CostTotals(
        fills=2 * len(result.trades),
        fees=round(fees, 6),
        slippage=round(slippage, 6),
        gross_pnl=round(gross, 6),
        net_pnl=round(net, 6),
    )


def bar_columns(bars: BarSeries, first: int) -> BarColumns:
    return BarColumns(
        time=(bars.ts_ns[first:] // 1_000_000_000).tolist(),
        open=bars.open[first:].tolist(),
        high=bars.high[first:].tolist(),
        low=bars.low[first:].tolist(),
        close=bars.close[first:].tolist(),
        volume=bars.volume[first:].tolist(),
    )


def truncation(bars: BarSeries, result: RunResult, settings: Settings) -> tuple[Truncation, int]:
    first = max(0, bars.size - settings.max_result_bars)
    trades_total = len(result.trades)
    trades_returned = min(trades_total, settings.max_result_trades)
    notes = []
    if first:
        notes.append(
            f"Only the last {settings.max_result_bars:,} of {bars.size:,} bars are included for "
            "the chart; every bar was used in the backtest."
        )
    if trades_returned < trades_total:
        notes.append(
            f"Only the last {trades_returned:,} of {trades_total:,} trades are listed; metrics "
            "and checks use every trade."
        )
    return (
        Truncation(
            bars_total=bars.size,
            bars_returned=bars.size - first,
            bars_first_index=first,
            bars_truncated=first > 0,
            trades_total=trades_total,
            trades_returned=trades_returned,
            trades_truncated=trades_returned < trades_total,
            note=" ".join(notes) or None,
        ),
        first,
    )


def execute(
    run_id: str,
    job: Job,
    reporter: Reporter,
    settings: Settings,
    csv_content: bytes | None = None,
    registry_factory: RegistryFactory = DataRegistry,
) -> tuple[bytes, str]:
    options = job.options
    if isinstance(options, RunRequest):
        loaded = load_provider(options, settings, registry_factory)
    else:
        loaded = load_csv(options, csv_content or b"")
    del csv_content
    data = loaded.data
    bars = data.bars
    reporter.send({"type": "run_started", "bar_count": bars.size})
    reporter.start("DATA")
    reporter.progress(50, loaded.detail)
    config = backtest_config(job)
    sessions = prepare_sessions(bars, config)
    session_count = int(np.unique(sessions.ordinal).size)
    reporter.progress(100, f"{session_count:,} sessions mapped · {data.source.mode}")
    reporter.done(f"{bars.size:,} bars · {data.gaps.missing_bars:,} missing")

    reporter.start("SIGNALS")
    spec = build_spec(options.strategy_id, job.parameters, job.market)
    plan = compile_spec(spec, bars, sessions)
    signals = signal_count(plan)
    reporter.progress(100, f"warm-up {plan.warmup} bars · {signals:,} raw entry signals")
    reporter.done(f"{signals:,} raw entry signals")

    reporter.start("SIMULATOR")
    clusters = ClusterBuilder(bars, reporter)
    last = {"percent": -SIMULATOR_STEP}

    def on_progress(stage: str, percent: int, bar_index: int | None) -> None:
        if stage != "SIMULATOR" or bar_index is None:
            return
        if percent - last["percent"] < SIMULATOR_STEP and percent < 100:
            return
        last["percent"] = percent
        reporter.progress(
            percent,
            f"bar {bar_index + 1:,} / {bars.size:,} · {clusters.seen:,} trades closed",
            bar_index,
        )

    output = run_plan(bars, plan, config, spec.name, sessions, on_progress, clusters.add)
    clusters.flush()
    result = output.result
    reporter.done(f"{bars.size:,} bars · {len(result.trades):,} trades")

    reporter.start("COSTS")
    totals = cost_totals(result)
    reporter.progress(50, f"fees {totals.fees:,.2f} over {totals.fills:,} fills")
    reporter.progress(100, f"slippage {totals.slippage:,.2f} · net = gross - fees - slippage")
    reporter.done(f"{totals.fills:,} fills costed · fees {totals.fees:,.2f}")

    reporter.start("AUDITOR")
    honesty = HonestyConfig(
        random_draws=options.honesty.random_draws, random_seed=options.honesty.seed
    )
    sweep = (
        SweepRequest(options.strategy_id, job.parameters, job.market)
        if options.honesty.sweep and options.strategy_id != "custom"
        else None
    )
    finished: list[CheckResult] = []

    def on_check(check: CheckResult) -> None:
        finished.append(check)
        reporter.progress(
            round(100 * len(finished) / len(CHECK_IDS)), f"check {len(finished)} / {len(CHECK_IDS)}"
        )
        reporter.send(
            {
                "type": "check_done",
                "check_id": check.id,
                "status": check.status,
                "figure": clip(check.headline),
            }
        )

    report = build_report(
        HonestyInput(bars, spec, config, output, options.strategy_id, job.parameters, sweep),
        honesty,
        on_check=on_check,
    )
    failed = sum(1 for check in report.checks if check.status == "FAIL")
    reporter.done(f"{len(report.checks)} checks · {failed} failed")

    reporter.start("REPORTER")
    grid = grid_from_candles(bars).grid
    reporter.progress(40, f"heatmap {grid.columns}x{grid.rows} · {grid.mode}")
    limits, first = truncation(bars, result, settings)
    trimmed = result.model_copy(
        update={"trades": result.trades[len(result.trades) - limits.trades_returned :]}
    )
    payload = RunResultPayload(
        run_id=run_id,
        request=job.options.model_dump(mode="json"),
        source=data.source,
        gaps=data.gaps,
        data_warnings=list(data.warnings),
        csv_report=loaded.csv_report,
        result=trimmed,
        report=report,
        heatmap=grid,
        costs=totals,
        bars=bar_columns(bars, first),
        limits=limits,
    )
    body = payload.model_dump_json().encode("utf-8")
    reporter.progress(100, f"result serialised · {len(body) / 1_048_576:,.1f} MB")
    return body, report.verdict.id
