from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict

Timeframe = Literal["1m", "5m", "15m", "30m", "1h", "4h", "1d"]
TIMEFRAME_MINUTES: dict[str, int] = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1_440,
}
COLUMNS = ("open", "high", "low", "close", "volume")
MAX_BARS = 2_000_000
EXAMPLE_LIMIT = 5


class BarProblem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    count: int
    examples: list[str]


class BarsValidationError(ValueError):
    def __init__(self, problems: list[BarProblem]) -> None:
        self.problems = problems
        super().__init__("; ".join(f"{p.message} ({p.count})" for p in problems))


@dataclass(frozen=True)
class BarSeries:
    ts_ns: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    timeframe: Timeframe

    @property
    def size(self) -> int:
        return int(self.ts_ns.size)

    @property
    def interval_minutes(self) -> int:
        return TIMEFRAME_MINUTES[self.timeframe]

    def timestamp(self, i: int) -> pd.Timestamp:
        return pd.Timestamp(int(self.ts_ns[i]), tz="UTC")

    def to_frame(self) -> pd.DataFrame:
        index = pd.DatetimeIndex(self.ts_ns.astype("datetime64[ns]")).tz_localize("UTC")
        return pd.DataFrame(
            {name: getattr(self, name) for name in COLUMNS}, index=index.rename("timestamp")
        )

    def replace(self, **arrays: np.ndarray) -> "BarSeries":
        values = {name: getattr(self, name) for name in ("ts_ns", *COLUMNS)}
        values.update(arrays)
        return BarSeries(timeframe=self.timeframe, **values)

    @classmethod
    def from_frame(cls, frame: pd.DataFrame, timeframe: Timeframe) -> "BarSeries":
        return validate_bars(frame, timeframe)


def _examples(labels: pd.Index, mask: np.ndarray) -> list[str]:
    return [str(label) for label in labels[np.flatnonzero(mask)[:EXAMPLE_LIMIT]]]


def _problem(code: str, message: str, labels: pd.Index, mask: np.ndarray) -> BarProblem | None:
    count = int(mask.sum())
    if count == 0:
        return None
    return BarProblem(code=code, message=message, count=count, examples=_examples(labels, mask))


def validate_bars(frame: pd.DataFrame, timeframe: Timeframe) -> BarSeries:
    if timeframe not in TIMEFRAME_MINUTES:
        raise BarsValidationError(
            [
                BarProblem(
                    code="timeframe",
                    message=f"unsupported timeframe {timeframe!r}",
                    count=1,
                    examples=[],
                )
            ]
        )
    problems: list[BarProblem] = []
    missing = [name for name in COLUMNS if name not in frame.columns]
    if missing:
        problems.append(
            BarProblem(
                code="missing_column",
                message="missing required columns",
                count=len(missing),
                examples=missing,
            )
        )
    if len(frame) == 0:
        problems.append(BarProblem(code="empty", message="no bars", count=1, examples=[]))
    if len(frame) > MAX_BARS:
        problems.append(
            BarProblem(
                code="too_many_bars",
                message=f"more than {MAX_BARS:,} bars",
                count=len(frame),
                examples=[],
            )
        )
    index = frame.index
    if not isinstance(index, pd.DatetimeIndex):
        problems.append(
            BarProblem(
                code="index_type",
                message="index must be a DatetimeIndex of bar open times",
                count=1,
                examples=[type(index).__name__],
            )
        )
    elif index.tz is None:
        problems.append(
            BarProblem(
                code="naive_timestamps",
                message="timestamps must be timezone-aware UTC",
                count=1,
                examples=[],
            )
        )
    elif str(index.tz) != "UTC":
        problems.append(
            BarProblem(
                code="not_utc",
                message=f"timestamps must be in UTC, got {index.tz}; convert them first",
                count=1,
                examples=[],
            )
        )
    if problems:
        raise BarsValidationError(problems)

    labels = frame.index
    ts_ns = labels.as_unit("ns").asi8
    step = np.diff(ts_ns)
    found: list[BarProblem | None] = [
        _problem(
            "duplicate_timestamp",
            "duplicate timestamps",
            labels[1:],
            step == 0,
        ),
        _problem(
            "not_increasing",
            "timestamps go backwards",
            labels[1:],
            step < 0,
        ),
    ]
    values: dict[str, np.ndarray] = {}
    for name in COLUMNS:
        column = pd.to_numeric(frame[name], errors="coerce").to_numpy(dtype=np.float64)
        values[name] = column
        found.append(
            _problem(
                f"invalid_{name}",
                f"{name} is missing, not a number or infinite",
                labels,
                ~np.isfinite(column),
            )
        )
    o, h, lo, c, v = (values[name] for name in COLUMNS)
    with np.errstate(invalid="ignore"):
        found.extend(
            [
                _problem(
                    "non_positive_price",
                    "open, high, low and close must be positive",
                    labels,
                    (o <= 0) | (h <= 0) | (lo <= 0) | (c <= 0),
                ),
                _problem("high_below_low", "high is below low", labels, h < lo),
                _problem(
                    "open_outside_range",
                    "open is outside the high-low range",
                    labels,
                    (o > h) | (o < lo),
                ),
                _problem(
                    "close_outside_range",
                    "close is outside the high-low range",
                    labels,
                    (c > h) | (c < lo),
                ),
                _problem("negative_volume", "volume is negative", labels, v < 0),
            ]
        )
    problems = [problem for problem in found if problem is not None]
    if problems:
        raise BarsValidationError(problems)
    return BarSeries(
        ts_ns=ts_ns.copy(),
        open=o,
        high=h,
        low=lo,
        close=c,
        volume=v,
        timeframe=timeframe,
    )
