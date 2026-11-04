from collections.abc import Callable
from datetime import datetime

import pandas as pd

from app.data.catalog import MAX_RANGE_DAYS, Window, check_symbol, check_window
from app.data.gaps import gap_report
from app.data.http import FetchBudget, HttpFetcher, fetch_slot
from app.data.models import DataResult, ProviderInfo, SourceDescriptor, SourceMode
from app.engine.bars import BarSeries, Timeframe
from app.engine.sessions import Crypto24x7Session, MarketKind

Now = Callable[[], pd.Timestamp]


def utc_now() -> pd.Timestamp:
    return pd.Timestamp.now(tz="UTC")


class CandleProvider:
    id: str
    display_name: str
    terms_url: str | None
    attribution: str
    note: str
    mode: SourceMode = "PUBLIC EXCHANGE DATA"
    market: MarketKind = "crypto_24x7"
    timeframes: tuple[Timeframe, ...]
    symbols: dict[str, str]
    max_range_days: dict[str, float] = MAX_RANGE_DAYS
    history_days: dict[str, float] | None = None
    max_requests: int = 200
    max_seconds: float = 60.0

    def __init__(self, fetcher: HttpFetcher, now: Now = utc_now) -> None:
        self.fetcher = fetcher
        self.now = now

    @classmethod
    def info(cls, enabled: bool = True) -> ProviderInfo:
        return ProviderInfo(
            id=cls.id,
            display_name=cls.display_name,
            kind="candles",
            enabled=enabled,
            markets=[cls.market],
            timeframes=list(cls.timeframes),
            max_range_days={tf: cls.max_range_days[tf] for tf in cls.timeframes},
            history_days=(
                {tf: cls.history_days[tf] for tf in cls.timeframes} if cls.history_days else None
            ),
            symbols=sorted(cls.symbols),
            terms_url=cls.terms_url,
            attribution=cls.attribution,
            mode=cls.mode,
            note=cls.note,
        )

    def window(self, start: datetime, end: datetime, timeframe: str) -> Window:
        return check_window(
            start,
            end,
            timeframe,
            self.timeframes,
            self.id,
            self.now(),
            self.max_range_days,
            self.history_days,
        )

    def budget(self) -> FetchBudget:
        return FetchBudget(max_requests=self.max_requests, max_seconds=self.max_seconds)

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> DataResult:
        native = check_symbol(symbol, self.symbols, self.id)
        window = self.window(start, end, timeframe)
        self.check_requests(window)
        with fetch_slot():
            bars = self.fetch_window(native, window, self.budget())
        return self.result(symbol, window, bars)

    def check_requests(self, window: Window) -> None:
        return None

    def fetch_window(self, native: str, window: Window, budget: FetchBudget) -> BarSeries:
        raise NotImplementedError

    def result(self, symbol: str, window: Window, bars: BarSeries) -> DataResult:
        return DataResult(
            bars=bars,
            source=SourceDescriptor(
                provider=self.id,
                display_name=self.display_name,
                terms_url=self.terms_url,
                attribution=self.attribution,
                mode=self.mode,
                symbol=symbol,
                market=self.market,
                timeframe=window.timeframe,
                start=window.start.to_pydatetime(),
                end=window.end.to_pydatetime(),
            ),
            gaps=gap_report(bars.ts_ns, window.timeframe, Crypto24x7Session()),
        )
