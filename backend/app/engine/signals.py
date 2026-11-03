from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

from app.engine import indicators
from app.engine.bars import BarSeries
from app.engine.sessions import SessionMap
from app.engine.spec import (
    AtrStop,
    Condition,
    Constant,
    FixedStop,
    LevelStop,
    LevelTarget,
    Linear,
    MovingTarget,
    OpeningRange,
    Periodic,
    Price,
    RMultipleTarget,
    SessionValue,
    SideRules,
    StrategySpec,
    side_operands,
)

StopKind = Literal["distance", "level"]
TargetKind = Literal["none", "r_multiple", "level", "moving"]


class SpecError(ValueError):
    pass


@dataclass(frozen=True)
class SidePlan:
    entry: np.ndarray
    stop_kind: StopKind
    stop_value: np.ndarray
    target_kind: TargetKind = "none"
    target_value: np.ndarray | None = None
    target_r: float = 0.0
    exit: np.ndarray | None = None


@dataclass(frozen=True)
class SignalPlan:
    long: SidePlan | None
    short: SidePlan | None
    warmup: int = 0
    session_end_exit: bool = True
    max_bars: int | None = None
    notes: list[str] = field(default_factory=list)


def _shift(values: np.ndarray) -> np.ndarray:
    out = np.full(values.size, np.nan)
    out[1:] = values[:-1]
    return out


def operand_warmup(operand: Price | Periodic | SessionValue | OpeningRange | Constant) -> int:
    if isinstance(operand, Price):
        return 1 if operand.kind == "prev_close" else 0
    if isinstance(operand, Periodic):
        if operand.kind in ("donchian_high", "donchian_low"):
            return indicators.WARMUP["donchian"](operand.period)
        if operand.kind == "vwap_dev_std":
            return indicators.WARMUP["rolling_std"](operand.period)
        return indicators.WARMUP[operand.kind](operand.period)
    return 0


class Evaluator:
    def __init__(self, bars: BarSeries, sessions: SessionMap) -> None:
        self.bars = bars
        self.sessions = sessions
        self.cache: dict[tuple, np.ndarray] = {}
        self._groups = pd.Series(sessions.ordinal)

    def operand(
        self, operand: Price | Periodic | SessionValue | OpeningRange | Constant
    ) -> np.ndarray:
        key = operand.key
        if key not in self.cache:
            self.cache[key] = self._compute(operand)
        return self.cache[key]

    def expr(
        self, expr: Price | Periodic | SessionValue | OpeningRange | Constant | Linear
    ) -> np.ndarray:
        if not isinstance(expr, Linear):
            return self.operand(expr)
        total = np.full(self.bars.size, float(expr.constant))
        for term in expr.terms:
            total = total + term.coef * self.operand(term.operand)
        return total

    def condition(self, condition: Condition) -> np.ndarray:
        left = self.expr(condition.left)
        right = self.expr(condition.right)
        with np.errstate(invalid="ignore"):
            if condition.op == ">":
                return left > right
            if condition.op == "<":
                return left < right
            if condition.op == ">=":
                return left >= right
            if condition.op == "<=":
                return left <= right
            previous_left = _shift(left)
            previous_right = _shift(right)
            if condition.op == "crosses_above":
                return (previous_left <= previous_right) & (left > right)
            return (previous_left >= previous_right) & (left < right)

    def all_of(self, conditions: list[Condition]) -> np.ndarray:
        result = np.ones(self.bars.size, dtype=bool)
        for condition in conditions:
            result &= self.condition(condition)
        return result

    def any_of(self, conditions: list[Condition]) -> np.ndarray:
        result = np.zeros(self.bars.size, dtype=bool)
        for condition in conditions:
            result |= self.condition(condition)
        return result

    def _compute(
        self, operand: Price | Periodic | SessionValue | OpeningRange | Constant
    ) -> np.ndarray:
        bars = self.bars
        if isinstance(operand, Constant):
            return np.full(bars.size, float(operand.value))
        if isinstance(operand, Price):
            if operand.kind == "prev_close":
                return _shift(bars.close)
            return getattr(bars, operand.kind)
        if isinstance(operand, Periodic):
            return self._periodic(operand)
        if isinstance(operand, OpeningRange):
            return self._opening_range(operand)
        return self._session_value(operand)

    def _periodic(self, operand: Periodic) -> np.ndarray:
        bars = self.bars
        period = operand.period
        if operand.kind == "sma":
            return indicators.sma(bars.close, period)
        if operand.kind == "ema":
            return indicators.ema(bars.close, period)
        if operand.kind == "rsi":
            return indicators.rsi(bars.close, period)
        if operand.kind == "atr":
            return indicators.atr(bars.high, bars.low, bars.close, period)
        if operand.kind == "adx":
            return indicators.adx(bars.high, bars.low, bars.close, period)
        if operand.kind == "donchian_high":
            return indicators.donchian(bars.high, bars.low, period)[0]
        if operand.kind == "donchian_low":
            return indicators.donchian(bars.high, bars.low, period)[1]
        deviation = bars.close - self.operand(SessionValue(kind="vwap"))
        return indicators.rolling_std(deviation, period)

    def _session_value(self, operand: SessionValue) -> np.ndarray:
        bars = self.bars
        sessions = self.sessions
        if operand.kind == "vwap":
            return indicators.session_vwap(
                bars.high, bars.low, bars.close, bars.volume, sessions.ordinal
            )
        if operand.kind == "minutes_since_open":
            return sessions.minutes_since_open.astype(np.float64)
        if operand.kind == "bar_in_session":
            return self._groups.groupby(self._groups).cumcount().to_numpy().astype(np.float64)
        if operand.kind == "session_open":
            first_open = np.where(
                sessions.first_in_session & sessions.starts_at_open, bars.open, np.nan
            )
            frame = pd.DataFrame({"s": sessions.ordinal, "v": first_open})
            return frame.groupby("s", sort=False)["v"].transform("first").to_numpy()
        return self._prev_session_close()

    def _prev_session_close(self) -> np.ndarray:
        sessions = self.sessions
        last_index = np.flatnonzero(np.append(sessions.ordinal[1:] != sessions.ordinal[:-1], True))
        ordinals = sessions.ordinal[last_index]
        closes = self.bars.close[last_index]
        complete = sessions.reaches_close[last_index]
        previous = np.full(ordinals.size, np.nan)
        if ordinals.size > 1:
            usable = (ordinals[1:] - ordinals[:-1] == 1) & complete[:-1]
            previous[1:] = np.where(usable, closes[:-1], np.nan)
        position = np.searchsorted(ordinals, sessions.ordinal)
        return previous[position]

    def _opening_range(self, operand: OpeningRange) -> np.ndarray:
        bars = self.bars
        sessions = self.sessions
        interval = bars.interval_minutes
        if operand.minutes < interval or operand.minutes % interval:
            raise SpecError(
                f"opening range of {operand.minutes} minutes must be a whole multiple of the "
                f"{bars.timeframe} bar interval"
            )
        needed = operand.minutes // interval
        minutes = sessions.minutes_since_open
        with np.errstate(invalid="ignore"):
            in_range = (minutes >= 0) & (minutes + interval <= operand.minutes)
            after = minutes >= operand.minutes
        source = bars.high if operand.kind == "opening_range_high" else bars.low
        frame = pd.DataFrame(
            {
                "s": sessions.ordinal,
                "v": np.where(in_range, source, np.nan),
                "n": in_range.astype(np.int64),
            }
        )
        grouped = frame.groupby("s", sort=False)
        how = "max" if operand.kind == "opening_range_high" else "min"
        level = grouped["v"].transform(how).to_numpy()
        count = grouped["n"].transform("sum").to_numpy()
        return np.where(after & (count == needed), level, np.nan)


def _side_plan(evaluator: Evaluator, rules: SideRules) -> SidePlan:
    size = evaluator.bars.size
    entry = evaluator.all_of(rules.entry)
    if isinstance(rules.stop, FixedStop):
        stop_kind: StopKind = "distance"
        stop_value = np.full(size, rules.stop.distance)
    elif isinstance(rules.stop, AtrStop):
        stop_kind = "distance"
        atr = evaluator.operand(Periodic(kind="atr", period=rules.stop.period))
        stop_value = atr * rules.stop.multiple
    elif isinstance(rules.stop, LevelStop):
        stop_kind = "level"
        stop_value = evaluator.expr(rules.stop.level)
    target_kind: TargetKind = "none"
    target_value = None
    target_r = 0.0
    if isinstance(rules.target, RMultipleTarget):
        target_kind = "r_multiple"
        target_r = rules.target.multiple
    elif isinstance(rules.target, LevelTarget):
        target_kind = "level"
        target_value = evaluator.expr(rules.target.level)
    elif isinstance(rules.target, MovingTarget):
        target_kind = "moving"
        target_value = evaluator.expr(rules.target.level)
    exit_signal = evaluator.any_of(rules.exit_any) if rules.exit_any else None
    return SidePlan(
        entry=entry,
        stop_kind=stop_kind,
        stop_value=stop_value,
        target_kind=target_kind,
        target_value=target_value,
        target_r=target_r,
        exit=exit_signal,
    )


def spec_warmup(spec: StrategySpec) -> int:
    warmup = 0
    for rules in (spec.long, spec.short):
        if rules is None:
            continue
        for operand in side_operands(rules):
            warmup = max(warmup, operand_warmup(operand))
        if any(c.op in ("crosses_above", "crosses_below") for c in rules.entry):
            warmup = max(warmup, 1 + max(operand_warmup(o) for o in side_operands(rules)))
    return warmup


def compile_spec(spec: StrategySpec, bars: BarSeries, sessions: SessionMap) -> SignalPlan:
    evaluator = Evaluator(bars, sessions)
    return SignalPlan(
        long=_side_plan(evaluator, spec.long) if spec.long else None,
        short=_side_plan(evaluator, spec.short) if spec.short else None,
        warmup=spec_warmup(spec),
        session_end_exit=spec.time_exit.session_end,
        max_bars=spec.time_exit.max_bars,
    )
