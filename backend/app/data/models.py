from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from app.engine.bars import BarSeries, Timeframe
from app.engine.sessions import MarketKind

SourceMode = Literal["PUBLIC EXCHANGE DATA", "SAMPLE DATA", "USER CSV", "PERSONAL USE ONLY"]
ProviderKind = Literal["candles", "trades", "sample", "csv"]
GAP_EXAMPLES = 20


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceDescriptor(Frozen):
    provider: str
    display_name: str
    terms_url: str | None
    attribution: str
    mode: SourceMode
    symbol: str
    market: MarketKind
    timeframe: Timeframe | None = None
    start: datetime | None = None
    end: datetime | None = None


class Gap(Frozen):
    start: datetime
    end: datetime
    missing_bars: int


class GapReport(Frozen):
    missing_bars: int
    gap_count: int
    gaps: Annotated[list[Gap], Field(max_length=GAP_EXAMPLES)]
    note: str


class ProviderInfo(Frozen):
    id: str
    display_name: str
    kind: ProviderKind
    enabled: bool
    markets: list[MarketKind]
    timeframes: list[Timeframe]
    max_range_days: dict[str, float]
    history_days: dict[str, float] | None = None
    symbols: list[str]
    terms_url: str | None
    attribution: str
    mode: SourceMode
    note: str


@dataclass(frozen=True)
class DataResult:
    bars: BarSeries
    source: SourceDescriptor
    gaps: GapReport
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class TradesResult:
    time_ns: np.ndarray
    price: np.ndarray
    volume: np.ndarray
    buy: np.ndarray
    source: SourceDescriptor
    covered_until: datetime
    truncated: bool


def utc(value: datetime) -> pd.Timestamp:
    stamp = pd.Timestamp(value)
    if stamp.tzinfo is None:
        raise ValueError("datetimes must be timezone-aware")
    return stamp.tz_convert("UTC")
