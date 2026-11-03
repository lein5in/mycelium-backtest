from collections.abc import Sequence

import pandas as pd

from app.engine.bars import BarSeries, Timeframe, validate_bars


def frame(
    rows: Sequence[Sequence[float]],
    start: str,
    freq: str = "1h",
    volume: float = 1_000.0,
) -> pd.DataFrame:
    index = pd.date_range(start, periods=len(rows), freq=freq, tz="UTC")
    data = [list(row) + ([volume] if len(row) == 4 else []) for row in rows]
    return pd.DataFrame(data, index=index, columns=["open", "high", "low", "close", "volume"])


def bars(
    rows: Sequence[Sequence[float]],
    start: str = "2024-01-01 00:00",
    timeframe: Timeframe = "1h",
    freq: str | None = None,
    volume: float = 1_000.0,
) -> BarSeries:
    step = freq or {"1m": "1min", "5m": "5min", "30m": "30min", "1h": "1h", "1d": "1D"}[timeframe]
    return validate_bars(frame(rows, start, step, volume), timeframe)


def flat(price: float) -> tuple[float, float, float, float]:
    return (price, price, price, price)
