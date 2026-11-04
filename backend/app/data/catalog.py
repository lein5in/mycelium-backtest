import re
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd

from app.data.errors import (
    BadPayloadError,
    InvalidSymbolError,
    NotFoundError,
    OutOfRangeError,
    UnsupportedError,
)
from app.data.models import utc
from app.engine.bars import (
    TIMEFRAME_MINUTES,
    BarSeries,
    BarsValidationError,
    Timeframe,
    validate_bars,
)

SYMBOL_PATTERN = re.compile(r"^[A-Z]{2,6}-[A-Z]{3,5}$")
MAX_RANGE_DAYS: dict[str, float] = {
    "1m": 30,
    "5m": 180,
    "15m": 365,
    "30m": 365,
    "1h": 730,
    "4h": 1_825,
    "1d": 1_825,
}


@dataclass(frozen=True)
class Window:
    start: pd.Timestamp
    end: pd.Timestamp
    timeframe: Timeframe

    @property
    def interval(self) -> pd.Timedelta:
        return pd.Timedelta(minutes=TIMEFRAME_MINUTES[self.timeframe])

    @property
    def bar_count(self) -> int:
        return int((self.end - self.start) / self.interval)


def check_symbol(symbol: object, allowed: dict[str, str], provider: str) -> str:
    if not isinstance(symbol, str) or not SYMBOL_PATTERN.fullmatch(symbol):
        raise InvalidSymbolError("Symbols look like BTC-USD (letters, a dash, letters).", provider)
    native = allowed.get(symbol)
    if native is None:
        supported = ", ".join(sorted(allowed))
        raise InvalidSymbolError(f"{symbol} is not offered here; available: {supported}.", provider)
    return native


def check_window(
    start: datetime,
    end: datetime,
    timeframe: object,
    timeframes: tuple[str, ...],
    provider: str,
    now: pd.Timestamp,
    max_range_days: dict[str, float] = MAX_RANGE_DAYS,
    history_days: dict[str, float] | None = None,
) -> Window:
    if timeframe not in timeframes:
        offered = ", ".join(timeframes)
        raise UnsupportedError(f"Timeframe {timeframe!r} is not offered; use {offered}.", provider)
    try:
        first, last = utc(start), utc(end)
    except (ValueError, TypeError) as error:
        raise OutOfRangeError("Start and end must be dates with a time zone.", provider) from error
    interval = pd.Timedelta(minutes=TIMEFRAME_MINUTES[timeframe])
    last = min(last, now.floor(interval))
    first = first.ceil(interval)
    if first >= last:
        raise OutOfRangeError("The range is empty: the start must be before the end.", provider)
    limit = max_range_days[timeframe]
    if last - first > pd.Timedelta(days=limit):
        raise OutOfRangeError(
            f"{timeframe} data is limited to {limit:g} days per run; choose a shorter range.",
            provider,
        )
    if history_days is not None:
        earliest = now - pd.Timedelta(days=history_days[timeframe])
        if first < earliest:
            raise OutOfRangeError(
                f"This source only keeps about {history_days[timeframe]:g} days of {timeframe} "
                "history; choose a more recent start.",
                provider,
            )
    return Window(start=first, end=last, timeframe=timeframe)


def bars_from_rows(
    seconds: np.ndarray,
    columns: dict[str, np.ndarray],
    window: Window,
    provider: str,
) -> BarSeries:
    index = pd.DatetimeIndex(pd.to_datetime(seconds.astype(np.int64), unit="s", utc=True))
    frame = pd.DataFrame(columns, index=index.as_unit("ns").rename("timestamp"))
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    frame = frame[(frame.index >= window.start) & (frame.index < window.end)]
    if frame.empty:
        raise NotFoundError("No candles were returned for this range.", provider)
    try:
        return validate_bars(frame, window.timeframe)
    except BarsValidationError as error:
        raise BadPayloadError(f"The data failed validation: {error}", provider) from error
