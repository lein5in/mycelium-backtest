import math
from dataclasses import dataclass
from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from app.engine.bars import BarSeries

GRID_SCHEMA_VERSION = 1
MAX_COLUMNS = 600
MAX_ROWS = 200
DEFAULT_ROWS = 120
BODY_WEIGHT = 2.0
WICK_WEIGHT = 1.0
CLIP_PERCENTILE = 99.0
CANDLE_BATCH = 4_096
NS_PER_SECOND = 1_000_000_000

HeatmapMode = Literal["FROM_TRADES", "ESTIMATED_FROM_CANDLES"]
MODE_LABELS: dict[str, str] = {
    "FROM_TRADES": "FROM TRADES",
    "ESTIMATED_FROM_CANDLES": "ESTIMATED FROM CANDLES",
}
ESTIMATION_RULE = (
    f"Each candle's volume is spread over its low-high range with a density of {BODY_WEIGHT:g} "
    f"inside the body (between open and close) and {WICK_WEIGHT:g} on the wicks; each price row "
    "receives the share of that density that falls inside it. A candle with no range puts all "
    "its volume in the row of its price. The buy share of a candle is (close - low) / "
    "(high - low), 0.5 when the range is zero; it is an estimate, not observed order flow."
)
TRADES_RULE = (
    "Each trade's volume goes to the cell of its time and price; the buy share is the share "
    "of volume from trades the exchange marks as buyer-initiated."
)
NORMALISATION_RULE = (
    f"intensity = min(1, log(1 + v / m) / log(1 + p / m)), where v is the cell volume, m the "
    f"median and p the {CLIP_PERCENTILE:g}th percentile of the non-empty cells; empty cells "
    "are 0."
)


class Method(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str
    volume_rule: str
    normalisation: str


class HeatmapGrid(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = GRID_SCHEMA_VERSION
    mode: HeatmapMode
    time_bucket_seconds: Annotated[int, Field(ge=1)]
    price_bucket: Annotated[float, Field(gt=0)]
    columns: Annotated[int, Field(ge=1, le=MAX_COLUMNS)]
    rows: Annotated[int, Field(ge=1, le=MAX_ROWS)]
    first_time: int
    lowest_price: float
    intensity: list[Annotated[float, Field(ge=0, le=1)]]
    buy_ratio: list[Annotated[float, Field(ge=0, le=1)]]
    profile_buy: list[Annotated[float, Field(ge=0)]]
    profile_sell: list[Annotated[float, Field(ge=0)]]
    poc_row: int | None
    poc_price: float | None
    total_volume: Annotated[float, Field(ge=0)]
    method: Method


@dataclass(frozen=True)
class HeatmapBuild:
    grid: HeatmapGrid
    volume: np.ndarray
    buy_volume: np.ndarray


def time_buckets(span: int, base_seconds: int, max_columns: int = MAX_COLUMNS) -> tuple[int, int]:
    factor = max(1, math.ceil(span / max_columns))
    return base_seconds * factor, math.ceil(span / factor)


def price_buckets(low: float, high: float, rows: int) -> tuple[float, float, int]:
    rows = max(1, min(MAX_ROWS, rows))
    if high > low:
        return low, (high - low) / rows, rows
    return low, max(abs(low) * 1e-4, 1e-9), 1


def normalise(volume: np.ndarray) -> np.ndarray:
    filled = volume[volume > 0]
    if filled.size == 0:
        return np.zeros_like(volume)
    median = float(np.median(filled))
    clip = float(np.percentile(filled, CLIP_PERCENTILE))
    intensity = np.log1p(volume / median) / np.log1p(clip / median)
    return np.clip(intensity, 0.0, 1.0)


def _finish(
    mode: HeatmapMode,
    rule: str,
    volume: np.ndarray,
    buy: np.ndarray,
    time_bucket: int,
    first_time: int,
    lowest: float,
    bucket: float,
) -> HeatmapBuild:
    columns, rows = volume.shape
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = np.where(volume > 0, buy / volume, 0.5)
    ratio = np.clip(ratio, 0.0, 1.0)
    profile_buy = buy.sum(axis=0)
    profile_sell = np.maximum(volume.sum(axis=0) - profile_buy, 0.0)
    totals = profile_buy + profile_sell
    total = float(volume.sum())
    poc = int(np.argmax(totals)) if total > 0 else None
    grid = HeatmapGrid(
        mode=mode,
        time_bucket_seconds=time_bucket,
        price_bucket=bucket,
        columns=columns,
        rows=rows,
        first_time=first_time,
        lowest_price=lowest,
        intensity=normalise(volume).reshape(-1).tolist(),
        buy_ratio=ratio.reshape(-1).tolist(),
        profile_buy=profile_buy.tolist(),
        profile_sell=profile_sell.tolist(),
        poc_row=poc,
        poc_price=lowest + (poc + 0.5) * bucket if poc is not None else None,
        total_volume=total,
        method=Method(label=MODE_LABELS[mode], volume_rule=rule, normalisation=NORMALISATION_RULE),
    )
    return HeatmapBuild(grid=grid, volume=volume, buy_volume=buy)


def _cumulative(prices: np.ndarray, low, high, body_low, body_high) -> np.ndarray:
    wick = np.clip(prices, low, high) - low
    body = np.clip(prices, body_low, body_high) - body_low
    return WICK_WEIGHT * wick + (BODY_WEIGHT - WICK_WEIGHT) * body


def grid_from_candles(
    bars: BarSeries, rows: int = DEFAULT_ROWS, max_columns: int = MAX_COLUMNS
) -> HeatmapBuild:
    interval = bars.interval_minutes * 60
    first_ns = int(bars.ts_ns[0])
    span = int((bars.ts_ns[-1] - first_ns) // (interval * NS_PER_SECOND)) + 1
    time_bucket, columns = time_buckets(span, interval, min(max_columns, MAX_COLUMNS))
    lowest, bucket, rows = price_buckets(float(bars.low.min()), float(bars.high.max()), rows)
    edges = lowest + bucket * np.arange(rows + 1)
    column = ((bars.ts_ns - first_ns) // (time_bucket * NS_PER_SECOND)).astype(np.int64)
    volume = np.zeros((columns, rows))
    buy = np.zeros((columns, rows))
    spread = bars.high - bars.low
    with np.errstate(invalid="ignore", divide="ignore"):
        clv = np.where(spread > 0, (bars.close - bars.low) / spread, 0.5)
    for start in range(0, bars.size, CANDLE_BATCH):
        part = slice(start, start + CANDLE_BATCH)
        low = bars.low[part, None]
        high = bars.high[part, None]
        body_low = np.minimum(bars.open[part], bars.close[part])[:, None]
        body_high = np.maximum(bars.open[part], bars.close[part])[:, None]
        cumulative = _cumulative(edges[None, :], low, high, body_low, body_high)
        weights = np.diff(cumulative, axis=1)
        totals = weights.sum(axis=1)
        flat = totals <= 0
        if flat.any():
            row = np.clip(((bars.close[part][flat] - lowest) // bucket).astype(int), 0, rows - 1)
            weights[flat] = 0.0
            weights[np.flatnonzero(flat), row] = 1.0
            totals = weights.sum(axis=1)
        shares = weights / totals[:, None]
        cells = shares * bars.volume[part, None]
        np.add.at(volume, column[part], cells)
        np.add.at(buy, column[part], cells * clv[part, None])
    return _finish(
        "ESTIMATED_FROM_CANDLES",
        ESTIMATION_RULE,
        volume,
        buy,
        time_bucket,
        first_ns // NS_PER_SECOND,
        lowest,
        bucket,
    )


def grid_from_trades(
    time_ns: np.ndarray,
    price: np.ndarray,
    size: np.ndarray,
    buyer: np.ndarray,
    bucket_seconds: int = 60,
    rows: int = DEFAULT_ROWS,
    max_columns: int = MAX_COLUMNS,
) -> HeatmapBuild:
    if time_ns.size == 0:
        raise ValueError("no trades to build a heatmap from")
    first_ns = int(time_ns.min()) - int(time_ns.min()) % (bucket_seconds * NS_PER_SECOND)
    span = int((int(time_ns.max()) - first_ns) // (bucket_seconds * NS_PER_SECOND)) + 1
    time_bucket, columns = time_buckets(span, bucket_seconds, min(max_columns, MAX_COLUMNS))
    lowest, bucket, rows = price_buckets(float(price.min()), float(price.max()), rows)
    column = ((time_ns - first_ns) // (time_bucket * NS_PER_SECOND)).astype(np.int64)
    row = np.clip(((price - lowest) // bucket).astype(np.int64), 0, rows - 1)
    volume = np.zeros((columns, rows))
    buy = np.zeros((columns, rows))
    np.add.at(volume, (column, row), size)
    np.add.at(buy, (column, row), np.where(buyer, size, 0.0))
    return _finish(
        "FROM_TRADES",
        TRADES_RULE,
        volume,
        buy,
        time_bucket,
        first_ns // NS_PER_SECOND,
        lowest,
        bucket,
    )
