import importlib
import re
from collections.abc import Callable
from datetime import datetime
from types import ModuleType

import pandas as pd

from app.data.base import Now, utc_now
from app.data.catalog import Window, check_window
from app.data.errors import (
    BadPayloadError,
    InvalidSymbolError,
    NetworkError,
    NotFoundError,
    UnsupportedError,
)
from app.data.gaps import gap_report
from app.data.http import fetch_slot
from app.data.models import DataResult, ProviderInfo, SourceDescriptor
from app.engine.bars import BarsValidationError, validate_bars
from app.engine.sessions import UsEquitySession

PROVIDER = "yahoo"
DISPLAY_NAME = "Yahoo Finance via yfinance (personal use only)"
TERMS_URL = "https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html"
ATTRIBUTION = (
    "Data from Yahoo Finance through the yfinance library: personal use only; not available "
    "in the hosted version."
)
TICKER_PATTERN = re.compile(r"^[A-Z]{1,5}([.-][A-Z]{1,2})?$")
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "1d")
INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "1d": "1d"}
MAX_RANGE_DAYS = {"1m": 7.0, "5m": 60.0, "15m": 60.0, "30m": 60.0, "1h": 730.0, "1d": 1_825.0}
HISTORY_DAYS = {"1m": 30.0, "5m": 60.0, "15m": 60.0, "30m": 60.0, "1h": 730.0, "1d": 36_500.0}

Loader = Callable[[], ModuleType]


def load_yfinance() -> ModuleType:
    try:
        return importlib.import_module("yfinance")
    except ImportError as error:
        raise UnsupportedError(
            "The Yahoo adapter is enabled but yfinance is not installed.", PROVIDER
        ) from error


def info(enabled: bool) -> ProviderInfo:
    return ProviderInfo(
        id=PROVIDER,
        display_name=DISPLAY_NAME,
        kind="candles",
        enabled=enabled,
        markets=["us_equity"],
        timeframes=list(TIMEFRAMES),
        max_range_days=MAX_RANGE_DAYS,
        history_days=HISTORY_DAYS,
        symbols=[],
        terms_url=TERMS_URL,
        attribution=ATTRIBUTION,
        mode="PERSONAL USE ONLY",
        note=(
            "Off unless MYCELIUM_ENABLE_YAHOO is set; never enabled in the hosted version. "
            "Yahoo keeps 1-minute bars for about 30 days (7 days per request) and 5 to "
            "30-minute bars for about 60 days."
        ),
    )


def _frame(raw: pd.DataFrame, window: Window) -> pd.DataFrame:
    if isinstance(raw.columns, pd.MultiIndex):
        raw = raw.droplevel(-1, axis=1) if raw.columns.nlevels > 1 else raw
    renamed = raw.rename(columns=str.lower)
    missing = [name for name in ("open", "high", "low", "close", "volume") if name not in renamed]
    if missing:
        raise BadPayloadError("Yahoo: the answer is missing price columns.", PROVIDER)
    frame = renamed[["open", "high", "low", "close", "volume"]].astype("float64")
    index = pd.DatetimeIndex(frame.index)
    if window.timeframe == "1d":
        index = pd.DatetimeIndex(index.tz_localize(None).normalize()).tz_localize("UTC")
    elif index.tz is None:
        raise BadPayloadError("Yahoo: intraday timestamps came without a time zone.", PROVIDER)
    else:
        index = index.tz_convert("UTC")
    frame.index = index.as_unit("ns").rename("timestamp")
    frame = frame.dropna(how="all")
    return frame[(frame.index >= window.start) & (frame.index < window.end)]


class YahooCandles:
    id = PROVIDER

    def __init__(self, loader: Loader = load_yfinance, now: Now = utc_now) -> None:
        self.loader = loader
        self.now = now

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> DataResult:
        if not isinstance(symbol, str) or not TICKER_PATTERN.fullmatch(symbol):
            raise InvalidSymbolError("Tickers look like SPY or BRK.B.", PROVIDER)
        window = check_window(
            start, end, timeframe, TIMEFRAMES, PROVIDER, self.now(), MAX_RANGE_DAYS, HISTORY_DAYS
        )
        module = self.loader()
        with fetch_slot():
            try:
                raw = module.download(
                    tickers=symbol,
                    start=window.start.to_pydatetime(),
                    end=window.end.to_pydatetime(),
                    interval=INTERVALS[timeframe],
                    auto_adjust=False,
                    actions=False,
                    prepost=False,
                    progress=False,
                    threads=False,
                )
            except Exception as error:
                raise NetworkError("Yahoo: the download failed.", PROVIDER) from error
        if not isinstance(raw, pd.DataFrame) or raw.empty:
            raise NotFoundError("Yahoo: no data for this ticker and range.", PROVIDER)
        frame = _frame(raw, window)
        if frame.empty:
            raise NotFoundError("Yahoo: no data for this ticker and range.", PROVIDER)
        try:
            bars = validate_bars(frame, timeframe)
        except BarsValidationError as error:
            raise BadPayloadError(
                f"Yahoo: the data failed validation: {error}", PROVIDER
            ) from error
        return DataResult(
            bars=bars,
            source=SourceDescriptor(
                provider=PROVIDER,
                display_name=DISPLAY_NAME,
                terms_url=TERMS_URL,
                attribution=ATTRIBUTION,
                mode="PERSONAL USE ONLY",
                symbol=symbol,
                market="us_equity",
                timeframe=timeframe,
                start=window.start.to_pydatetime(),
                end=window.end.to_pydatetime(),
            ),
            gaps=gap_report(bars.ts_ns, timeframe, UsEquitySession()),
        )
