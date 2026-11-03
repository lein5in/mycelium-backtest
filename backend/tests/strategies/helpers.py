from datetime import date

import numpy as np
import pandas as pd

from app.engine import BacktestConfig, run_backtest, validate_bars
from app.engine.bars import BarSeries
from app.engine.models import CostModel, Instrument
from app.engine.sessions import (
    Crypto24x7Session,
    UsEquitySession,
    map_sessions,
    nyse_calendar,
    session_bounds,
)
from app.engine.signals import compile_spec
from app.engine.spec import StrategySpec

COSTS = CostModel(fixed_fee=1.0)
INSTRUMENT = Instrument(tick_size=0.01, quantity_step=1.0)
CRYPTO = BacktestConfig(session=Crypto24x7Session(), costs=COSTS, instrument=INSTRUMENT)
US = BacktestConfig(session=UsEquitySession(), costs=COSTS, instrument=INSTRUMENT)
FREQ = {"1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "1d": "1D"}


def quiet(price: float = 100.0, half_range: float = 0.5) -> tuple[float, float, float, float]:
    return (price, price + half_range, price - half_range, price)


def crypto_bars(rows, start: str, timeframe: str = "5m") -> BarSeries:
    index = pd.date_range(start, periods=len(rows), freq=FREQ[timeframe], tz="UTC")
    frame = pd.DataFrame(rows, index=index, columns=["open", "high", "low", "close"])
    frame["volume"] = 1_000.0
    return validate_bars(frame, timeframe)


def us_session_bars(sessions: dict[str, list], timeframe: str = "30m") -> BarSeries:
    frames = []
    for day, rows in sessions.items():
        open_, _ = session_bounds(UsEquitySession(), date.fromisoformat(day))
        index = pd.date_range(open_, periods=len(rows), freq=FREQ[timeframe])
        frames.append(pd.DataFrame(rows, index=index, columns=["open", "high", "low", "close"]))
    frame = pd.concat(frames)
    frame["volume"] = 1_000.0
    return validate_bars(frame, timeframe)


def _walk(rng, count, start, step):
    close = start * np.exp(np.cumsum(rng.normal(0, step, count)))
    open_ = np.r_[start, close[:-1]] * np.exp(rng.normal(0, step / 4, count))
    high = np.maximum(open_, close) * (1 + rng.uniform(0, step, count))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, step, count))
    return np.column_stack([open_, high, low, close])


def random_crypto(count: int, seed: int, timeframe: str = "1h", start: str = "2024-01-01"):
    rng = np.random.default_rng(seed)
    data = _walk(rng, count, 100.0, 0.006)
    index = pd.date_range(start, periods=count, freq=FREQ[timeframe], tz="UTC")
    frame = pd.DataFrame(data, index=index, columns=["open", "high", "low", "close"])
    frame["volume"] = rng.uniform(500, 1_500, count)
    return validate_bars(frame, timeframe)


def random_us(
    sessions: int, seed: int, timeframe: str = "5m", first: str = "2024-10-01", gap: float = 0.015
):
    rng = np.random.default_rng(seed)
    calendar = nyse_calendar()
    days = calendar.sessions[calendar.sessions >= pd.Timestamp(first)][:sessions]
    minutes = int(FREQ[timeframe].rstrip("min")) if timeframe.endswith("m") else 60
    frames = []
    price = 100.0
    for day in days:
        open_, close = session_bounds(UsEquitySession(), day.date())
        count = int((close - open_).total_seconds() // 60 // minutes)
        price *= float(np.exp(rng.normal(0, gap)))
        data = _walk(rng, count, price, 0.002)
        price = float(data[-1, 3])
        index = pd.date_range(open_, periods=count, freq=FREQ[timeframe])
        frames.append(pd.DataFrame(data, index=index, columns=["open", "high", "low", "close"]))
    frame = pd.concat(frames)
    frame["volume"] = rng.uniform(500, 1_500, len(frame))
    return validate_bars(frame, timeframe)


def run(spec: StrategySpec, bars: BarSeries, config: BacktestConfig):
    return run_backtest(bars, spec, config).result


def trade_tuple(trade):
    return (trade.side, trade.entry_index, trade.entry_price, trade.exit_reason, trade.net_pnl)


def plan_arrays(plan):
    arrays = []
    for side in (plan.long, plan.short):
        if side is None:
            continue
        arrays.extend([side.entry, side.stop_value])
        if side.target_value is not None:
            arrays.append(side.target_value)
        if side.exit is not None:
            arrays.append(side.exit)
    return arrays


def altered_after(bars: BarSeries, k: int, seed: int) -> BarSeries:
    rng = np.random.default_rng(seed)
    count = bars.size - k - 1
    data = _walk(rng, count, float(bars.close[k]) * 1.03, 0.01)
    return bars.replace(
        open=np.r_[bars.open[: k + 1], data[:, 0]],
        high=np.r_[bars.high[: k + 1], data[:, 1]],
        low=np.r_[bars.low[: k + 1], data[:, 2]],
        close=np.r_[bars.close[: k + 1], data[:, 3]],
        volume=np.r_[bars.volume[: k + 1], rng.uniform(500, 1_500, count)],
    )


def assert_no_look_ahead(spec: StrategySpec, bars: BarSeries, config: BacktestConfig, k: int):
    changed = altered_after(bars, k, seed=k)
    sessions = map_sessions(config.session, bars.ts_ns, bars.interval_minutes)
    for original, modified in zip(
        plan_arrays(compile_spec(spec, bars, sessions)),
        plan_arrays(compile_spec(spec, changed, sessions)),
        strict=True,
    ):
        np.testing.assert_array_equal(original[: k + 1], modified[: k + 1])
    first = run(spec, bars, config).trades
    second = run(spec, changed, config).trades
    assert [t for t in first if t.exit_index <= k] == [t for t in second if t.exit_index <= k]
    assert [t.signal_index for t in first if t.signal_index < k] == [
        t.signal_index for t in second if t.signal_index < k
    ]
    return first
