import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig, FixedFraction
from app.engine.sessions import SessionMap
from app.engine.signals import SidePlan, SignalPlan

ProgressCallback = Callable[[str, int, int | None], None]
LONG = 1
SHORT = -1


@dataclass
class TradeRecord:
    side: int
    signal_index: int
    entry_index: int
    exit_index: int
    exit_fill: str
    quantity: float
    entry_price: float
    exit_price: float
    stop_price: float
    target_price: float | None
    exit_reason: str
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    bars_held: int


@dataclass
class HaltRecord:
    bar_index: int
    drawdown_pct: float


@dataclass
class SimulationOutput:
    trades: list[TradeRecord]
    equity: np.ndarray
    halted: HaltRecord | None
    signals: int
    entries: int
    skipped: dict[str, int] = field(default_factory=dict)


@dataclass
class _Position:
    side: int
    quantity: float
    entry_ref: float
    entry_fill: float
    entry_fee: float
    entry_slippage: float
    entry_index: int
    signal_index: int
    stop: float
    target: float | None
    moving: list[float] | None


def _side_lists(plan: SidePlan | None, size: int) -> dict:
    if plan is None:
        return {"entry": [False] * size}
    return {
        "plan": plan,
        "entry": plan.entry.tolist(),
        "stop": plan.stop_value.tolist(),
        "target": plan.target_value.tolist() if plan.target_value is not None else None,
        "exit": plan.exit.tolist() if plan.exit is not None else None,
    }


def simulate(
    bars: BarSeries,
    sessions: SessionMap,
    plan: SignalPlan,
    config: BacktestConfig,
    progress: ProgressCallback | None = None,
) -> SimulationOutput:
    size = bars.size
    opens = bars.open.tolist()
    highs = bars.high.tolist()
    lows = bars.low.tolist()
    closes = bars.close.tolist()
    ordinal = sessions.ordinal.tolist()
    last_in_session = sessions.last_in_session.tolist()
    sides = {LONG: _side_lists(plan.long, size), SHORT: _side_lists(plan.short, size)}
    long_entry = sides[LONG]["entry"]
    short_entry = sides[SHORT]["entry"]

    costs = config.costs
    tick = config.instrument.tick_size
    slip_in_ticks = costs.slippage.unit == "ticks"
    slip_value = costs.slippage.value
    fee_rate = costs.fee_pct / 100.0
    fixed_fee = costs.fixed_fee
    quantity_step = config.instrument.quantity_step
    initial = config.initial_capital
    sizing = config.sizing
    risk = config.risk
    drawdown_limit = risk.max_drawdown_pct
    session_loss_limit = risk.max_session_loss_pct
    trade_cap = risk.max_trades_per_session
    session_end_exit = plan.session_end_exit
    max_bars = plan.max_bars
    warmup = plan.warmup

    def slip(price: float) -> float:
        return slip_value * tick if slip_in_ticks else price * slip_value / 10_000.0

    equity = np.empty(size, dtype=np.float64)
    trades: list[TradeRecord] = []
    skipped: Counter[str] = Counter()
    session_entries: Counter[int] = Counter()
    realised = initial
    peak = initial
    last_equity = initial
    session_start_equity = initial
    current_session: int | None = None
    blocked_session: int | None = None
    halted: HaltRecord | None = None
    pending_entry: tuple[int, int] | None = None
    pending_exit: str | None = None
    position: _Position | None = None
    signals = 0
    entries = 0
    report_every = max(1, size // 100)

    def close_position(index: int, reference: float, reason: str, fill_point: str) -> None:
        nonlocal realised, position, pending_exit
        held = position
        assert held is not None
        exit_slippage = slip(reference)
        exit_fill = reference - held.side * exit_slippage
        exit_fee = exit_fill * held.quantity * fee_rate + fixed_fee
        gross = held.side * held.quantity * (reference - held.entry_ref)
        fees = held.entry_fee + exit_fee
        slippage_cost = held.quantity * (held.entry_slippage + exit_slippage)
        net = held.side * held.quantity * (exit_fill - held.entry_fill) - fees
        realised += net
        bars_held = index - held.entry_index + (0 if fill_point == "open" else 1)
        trades.append(
            TradeRecord(
                side=held.side,
                signal_index=held.signal_index,
                entry_index=held.entry_index,
                exit_index=index,
                exit_fill=fill_point,
                quantity=held.quantity,
                entry_price=held.entry_fill,
                exit_price=exit_fill,
                stop_price=held.stop,
                target_price=held.target,
                exit_reason=reason,
                gross_pnl=gross,
                fees=fees,
                slippage_cost=slippage_cost,
                net_pnl=net,
                bars_held=bars_held,
            )
        )
        position = None
        pending_exit = None

    def open_position(index: int, side: int, signal_index: int) -> _Position | None:
        lists = sides[side]
        side_plan: SidePlan = lists["plan"]
        reference = opens[index]
        entry_slippage = slip(reference)
        fill = reference + side * entry_slippage
        raw_stop = lists["stop"][signal_index]
        if not math.isfinite(raw_stop):
            skipped["stop_not_ready"] += 1
            return None
        if side_plan.stop_kind == "distance":
            if raw_stop <= 0:
                skipped["stop_not_ready"] += 1
                return None
            stop = fill - side * raw_stop
        else:
            stop = raw_stop
        if side * (reference - stop) <= 0:
            skipped["stop_beyond_open"] += 1
            return None
        target: float | None = None
        moving: list[float] | None = None
        if side_plan.target_kind == "r_multiple":
            target = fill + side * side_plan.target_r * abs(fill - stop)
        elif side_plan.target_kind in ("level", "moving"):
            level = lists["target"][signal_index]
            if side_plan.target_kind == "level" and not math.isfinite(level):
                skipped["target_not_ready"] += 1
                return None
            if math.isfinite(level) and side * (level - reference) <= 0:
                skipped["target_beyond_open"] += 1
                return None
            if side_plan.target_kind == "level":
                target = level
            else:
                moving = lists["target"]
        base = realised if config.compounding else initial
        unit_cost = fill * (1.0 + fee_rate)
        affordable = (base - fixed_fee) / unit_cost if base > fixed_fee else 0.0
        if isinstance(sizing, FixedFraction):
            quantity = (base * sizing.fraction - fixed_fee) / unit_cost
        else:
            quantity = base * sizing.percent / 100.0 / abs(fill - stop)
        quantity = min(quantity, affordable)
        if quantity_step is not None:
            quantity = math.floor(quantity / quantity_step + 1e-9) * quantity_step
        if not quantity > 0:
            skipped["insufficient_capital"] += 1
            return None
        return _Position(
            side=side,
            quantity=quantity,
            entry_ref=reference,
            entry_fill=fill,
            entry_fee=fill * quantity * fee_rate + fixed_fee,
            entry_slippage=entry_slippage,
            entry_index=index,
            signal_index=signal_index,
            stop=stop,
            target=target,
            moving=moving,
        )

    def target_for(held: _Position, index: int) -> float | None:
        if held.moving is None:
            return held.target
        level = held.moving[index - 1]
        return level if math.isfinite(level) else None

    for j in range(size):
        session = ordinal[j]
        if session != current_session:
            current_session = session
            session_start_equity = last_equity

        if position is not None:
            side = position.side
            open_price = opens[j]
            if pending_exit is not None:
                close_position(j, open_price, pending_exit, "open")
            elif side * (open_price - position.stop) <= 0:
                close_position(j, open_price, "stop", "open")
            else:
                target = target_for(position, j)
                if target is not None and side * (open_price - target) >= 0:
                    close_position(j, open_price, "target", "open")
        elif pending_entry is not None:
            side, signal_index = pending_entry
            position = open_position(j, side, signal_index)
            if position is not None:
                entries += 1
                session_entries[session] += 1
        pending_entry = None

        if position is not None:
            side = position.side
            adverse = lows[j] if side == LONG else highs[j]
            favourable = highs[j] if side == LONG else lows[j]
            if side * (adverse - position.stop) <= 0:
                close_position(j, position.stop, "stop", "intrabar")
            else:
                target = target_for(position, j)
                if target is not None and side * (favourable - target) >= 0:
                    close_position(j, target, "target", "intrabar")

        if position is not None:
            if (session_end_exit and last_in_session[j]) or (
                max_bars is not None and j - position.entry_index + 1 >= max_bars
            ):
                close_position(j, closes[j], "time_exit", "close")
            elif j == size - 1:
                close_position(j, closes[j], "end_of_data", "close")
            else:
                exits = sides[position.side]["exit"]
                if exits is not None and exits[j]:
                    pending_exit = "exit_signal"

        if position is None:
            marked = realised
        else:
            marked = (
                realised
                + position.side * position.quantity * (closes[j] - position.entry_fill)
                - position.entry_fee
            )
        equity[j] = marked
        last_equity = marked

        if marked > peak:
            peak = marked
        if drawdown_limit is not None and halted is None and peak > 0:
            drawdown = (peak - marked) / peak * 100.0
            if drawdown >= drawdown_limit:
                halted = HaltRecord(bar_index=j, drawdown_pct=drawdown)
                if position is not None:
                    pending_exit = "risk_limit"
        if (
            session_loss_limit is not None
            and blocked_session != session
            and session_start_equity - marked >= session_loss_limit / 100.0 * session_start_equity
        ):
            blocked_session = session
            if position is not None:
                pending_exit = "risk_limit"

        if position is None and j + 1 < size and (long_entry[j] or short_entry[j]):
            signals += 1
            reason = None
            next_session = ordinal[j + 1]
            if halted is not None:
                reason = "halted"
            elif j < warmup:
                reason = "warmup"
            elif long_entry[j] and short_entry[j]:
                reason = "conflicting_signals"
            elif session_end_exit and last_in_session[j]:
                reason = "session_end"
            elif next_session == blocked_session:
                reason = "session_loss_limit"
            elif session_entries[next_session] >= trade_cap:
                reason = "trade_cap"
            if reason is None:
                pending_entry = (LONG if long_entry[j] else SHORT, j)
            else:
                skipped[reason] += 1

        if progress is not None and j % report_every == 0:
            progress("SIMULATOR", int(100 * j / size), j)

        if halted is not None and position is None and pending_entry is None:
            equity[j + 1 :] = marked
            break

    if progress is not None:
        progress("SIMULATOR", 100, size - 1)
    return SimulationOutput(
        trades=trades,
        equity=equity,
        halted=halted,
        signals=signals,
        entries=entries,
        skipped=dict(skipped),
    )
