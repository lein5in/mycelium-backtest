from dataclasses import dataclass
from datetime import date, datetime

import numpy as np
import pandas as pd

from app.engine.bars import BarProblem, BarSeries, BarsValidationError
from app.engine.metrics import calendar, compute_metrics, daily_equity
from app.engine.models import BacktestConfig, FixedFraction
from app.engine.results import Diagnostics, Halt, RunResult, Trade
from app.engine.sessions import NS_PER_DAY, NS_PER_MINUTE, SessionMap, map_sessions
from app.engine.signals import SignalPlan, compile_spec
from app.engine.simulation import ProgressCallback, SimulationOutput, simulate
from app.engine.spec import StrategySpec

EXAMPLE_LIMIT = 5


class IncompatibleMarketError(ValueError):
    pass


@dataclass(frozen=True)
class BacktestOutput:
    result: RunResult
    equity: np.ndarray
    sessions: SessionMap


def _emit(progress: ProgressCallback | None, stage: str, percent: int) -> None:
    if progress is not None:
        progress(stage, percent, None)


def prepare_sessions(bars: BarSeries, config: BacktestConfig) -> SessionMap:
    sessions = map_sessions(config.session, bars.ts_ns, bars.interval_minutes)
    if sessions.outside.any():
        examples = [str(bars.timestamp(int(i))) for i in np.flatnonzero(sessions.outside)]
        raise BarsValidationError(
            [
                BarProblem(
                    code="outside_session",
                    message=f"bars fall outside {config.session.kind} trading sessions",
                    count=int(sessions.outside.sum()),
                    examples=examples[:EXAMPLE_LIMIT],
                )
            ]
        )
    return sessions


def assumptions(config: BacktestConfig, plan: SignalPlan) -> list[str]:
    costs = config.costs
    slippage = costs.slippage
    slip_text = (
        f"{slippage.value:g} tick(s) of {config.instrument.tick_size:g}"
        if slippage.unit == "ticks"
        else f"{slippage.value:g} basis points"
    )
    sizing = config.sizing
    sizing_text = (
        f"{sizing.fraction * 100:g}% of equity per trade, no leverage"
        if isinstance(sizing, FixedFraction)
        else f"risk of {sizing.percent:g}% of equity per trade at the stop, capped at no leverage"
    )
    base = "current realised equity" if config.compounding else "the initial capital"
    lines = [
        "Spot instruments: no leverage, no margin, long and short treated symmetrically.",
        "No funding, borrow, financing or dividend costs are modelled.",
        "Signals are evaluated at the close of a bar; entries and signal exits fill at the "
        "open of the next bar.",
        f"Slippage is adverse on every fill, entry and exit: {slip_text}.",
        f"Fees on every fill: {costs.fee_pct:g}% of notional plus {costs.fixed_fee:g} fixed.",
        f"Position size: {sizing_text}, computed on {base}.",
        "Stops and targets are checked from the entry bar, using each bar's high and low.",
        "When one bar reaches both the stop and the target, the stop is assumed hit first.",
        "A bar that opens beyond the stop or the target fills at its open, not at the level.",
        "Fill prices are not rounded to the tick size.",
        f"At most {config.risk.max_trades_per_session} trade(s) per session; one position "
        "at a time.",
    ]
    if plan.session_end_exit:
        lines.append(
            "Open positions exit at the close of the session's last bar (time exit); "
            "signals on that last bar are ignored."
        )
    if plan.max_bars is not None:
        lines.append(f"Positions exit at the close after {plan.max_bars} bar(s) held.")
    if config.risk.max_session_loss_pct is not None:
        lines.append(
            f"Session loss limit {config.risk.max_session_loss_pct:g}% of the equity at the "
            "session start (realised plus open): flatten at the next open, no new entries "
            "that session."
        )
    if config.risk.max_drawdown_pct is not None:
        lines.append(
            f"Drawdown limit {config.risk.max_drawdown_pct:g}% (marked to market at each "
            "close): flatten at the next open and halt the run."
        )
    lines.extend(plan.notes)
    return lines


def _timestamp(ts_ns: np.ndarray, index: int) -> datetime:
    return pd.Timestamp(int(ts_ns[index]), tz="UTC").to_pydatetime()


def _label(sessions: SessionMap, index: int) -> date:
    return pd.Timestamp(int(sessions.label_ns[index])).date()


def _trades(bars: BarSeries, sessions: SessionMap, output: SimulationOutput) -> list[Trade]:
    trades = []
    for record in output.trades:
        trades.append(
            Trade(
                side="long" if record.side > 0 else "short",
                signal_index=record.signal_index,
                entry_index=record.entry_index,
                exit_index=record.exit_index,
                signal_time=_timestamp(bars.ts_ns, record.signal_index),
                entry_time=_timestamp(bars.ts_ns, record.entry_index),
                exit_time=_timestamp(bars.ts_ns, record.exit_index),
                exit_fill=record.exit_fill,
                session=_label(sessions, record.entry_index),
                exit_session=_label(sessions, record.exit_index),
                quantity=record.quantity,
                entry_price=record.entry_price,
                exit_price=record.exit_price,
                stop_price=record.stop_price,
                target_price=record.target_price,
                exit_reason=record.exit_reason,
                gross_pnl=record.gross_pnl,
                fees=record.fees,
                slippage_cost=record.slippage_cost,
                net_pnl=record.net_pnl,
                bars_held=record.bars_held,
            )
        )
    return trades


def run_plan(
    bars: BarSeries,
    plan: SignalPlan,
    config: BacktestConfig,
    strategy_name: str,
    sessions: SessionMap | None = None,
    progress: ProgressCallback | None = None,
) -> BacktestOutput:
    if sessions is None:
        sessions = prepare_sessions(bars, config)
    output = simulate(bars, sessions, plan, config, progress)
    _emit(progress, "REPORTER", 0)
    trades = _trades(bars, sessions, output)
    labels = pd.DatetimeIndex(sessions.label_ns.astype("datetime64[ns]")).date.tolist()
    daily = daily_equity(output.equity, labels, config.initial_capital)
    span_ns = int(bars.ts_ns[-1] - bars.ts_ns[0]) + bars.interval_minutes * NS_PER_MINUTE
    metrics = compute_metrics(
        trades,
        output.equity,
        daily,
        config.initial_capital,
        bars.size,
        span_ns / NS_PER_DAY,
        config.annualisation_days,
    )
    halted = None
    if output.halted is not None:
        halted = Halt(
            reason="max_drawdown",
            bar_index=output.halted.bar_index,
            time=_timestamp(bars.ts_ns, output.halted.bar_index),
            drawdown_pct=output.halted.drawdown_pct,
        )
    result = RunResult(
        strategy=strategy_name,
        market=config.session.kind,
        timeframe=bars.timeframe,
        bar_count=bars.size,
        first_bar=_timestamp(bars.ts_ns, 0),
        last_bar=_timestamp(bars.ts_ns, bars.size - 1),
        warmup_bars=plan.warmup,
        trades=trades,
        daily_equity=daily,
        metrics=metrics,
        calendar=calendar(trades),
        halted=halted,
        diagnostics=Diagnostics(
            signals=output.signals, entries=output.entries, skipped=output.skipped
        ),
        assumptions=assumptions(config, plan),
    )
    _emit(progress, "REPORTER", 100)
    return BacktestOutput(result=result, equity=output.equity, sessions=sessions)


def run_backtest(
    bars: BarSeries,
    spec: StrategySpec,
    config: BacktestConfig,
    progress: ProgressCallback | None = None,
) -> BacktestOutput:
    if config.session.kind not in spec.markets:
        supported = ", ".join(spec.markets)
        raise IncompatibleMarketError(
            f"strategy {spec.name!r} does not support {config.session.kind}; "
            f"supported markets: {supported}"
        )
    _emit(progress, "DATA", 0)
    sessions = prepare_sessions(bars, config)
    _emit(progress, "DATA", 100)
    _emit(progress, "SIGNALS", 0)
    plan = compile_spec(spec, bars, sessions)
    _emit(progress, "SIGNALS", 100)
    return run_plan(bars, plan, config, spec.name, sessions, progress)
