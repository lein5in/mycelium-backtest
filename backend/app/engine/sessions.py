from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import exchange_calendars as xc
import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, field_validator

NS_PER_MINUTE = 60_000_000_000
NS_PER_DAY = 1_440 * NS_PER_MINUTE
NYSE_CODE = "XNYS"
NYSE_TIMEZONE = "America/New_York"
CALENDAR_START = "1995-01-01"
CALENDAR_END = "2035-12-31"

MarketKind = Literal["us_equity", "crypto_24x7"]
MARKET_KINDS: tuple[MarketKind, ...] = ("us_equity", "crypto_24x7")


class SessionError(ValueError):
    pass


class UsEquitySession(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["us_equity"] = "us_equity"


class Crypto24x7Session(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["crypto_24x7"] = "crypto_24x7"
    anchor: time = time(0, 0)
    timezone: Annotated[str, Field(min_length=1, max_length=64)] = "UTC"

    @field_validator("anchor")
    @classmethod
    def minute_precision(cls, value: time) -> time:
        if value.tzinfo is not None:
            raise ValueError("anchor must be a wall-clock time without timezone; use `timezone`")
        if value.second or value.microsecond:
            raise ValueError("anchor must be given to the minute (HH:MM)")
        return value

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"unknown timezone {value!r}") from error
        return value


MarketSession = Annotated[UsEquitySession | Crypto24x7Session, Field(discriminator="kind")]


@lru_cache(maxsize=1)
def nyse_calendar() -> xc.ExchangeCalendar:
    return xc.get_calendar(NYSE_CODE, start=CALENDAR_START, end=CALENDAR_END)


@lru_cache(maxsize=1)
def _nyse_arrays() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    calendar = nyse_calendar()
    labels = calendar.sessions.as_unit("ns").asi8
    opens = calendar.opens.dt.as_unit("ns").astype("int64").to_numpy()
    closes = calendar.closes.dt.as_unit("ns").astype("int64").to_numpy()
    return labels, opens, closes


def _utc(ts: datetime | pd.Timestamp) -> pd.Timestamp:
    stamp = pd.Timestamp(ts)
    if stamp.tzinfo is None:
        raise SessionError("timestamps must be timezone-aware")
    return stamp.tz_convert("UTC").as_unit("ns")


def _check_nyse_range(day: date) -> None:
    calendar = nyse_calendar()
    if not calendar.first_session.date() <= day <= calendar.last_session.date():
        raise SessionError(
            f"{day.isoformat()} is outside the supported NYSE calendar range "
            f"({calendar.first_session.date()} to {calendar.last_session.date()})"
        )


def _crypto_open(session: Crypto24x7Session, day: date) -> pd.Timestamp:
    wall = pd.Timestamp(datetime.combine(day, session.anchor))
    return wall.tz_localize(
        session.timezone, nonexistent="shift_forward", ambiguous=True
    ).tz_convert("UTC")


def is_trading_session(session: UsEquitySession | Crypto24x7Session, day: date) -> bool:
    if isinstance(session, Crypto24x7Session):
        return True
    _check_nyse_range(day)
    return bool(nyse_calendar().is_session(pd.Timestamp(day)))


def session_bounds(
    session: UsEquitySession | Crypto24x7Session, day: date
) -> tuple[pd.Timestamp, pd.Timestamp]:
    if isinstance(session, Crypto24x7Session):
        return _crypto_open(session, day), _crypto_open(session, day + timedelta(days=1))
    if not is_trading_session(session, day):
        raise SessionError(f"{day.isoformat()} is not an NYSE trading session")
    calendar = nyse_calendar()
    label = pd.Timestamp(day)
    return (
        calendar.session_open(label).as_unit("ns"),
        calendar.session_close(label).as_unit("ns"),
    )


def session_of(
    session: UsEquitySession | Crypto24x7Session, ts: datetime | pd.Timestamp
) -> date | None:
    stamp = _utc(ts)
    if isinstance(session, Crypto24x7Session):
        wall = stamp.tz_convert(session.timezone).tz_localize(None)
        anchor = timedelta(hours=session.anchor.hour, minutes=session.anchor.minute)
        return (wall - anchor).date()
    day = stamp.tz_convert(NYSE_TIMEZONE).date()
    if not is_trading_session(session, day):
        return None
    open_, close = session_bounds(session, day)
    return day if open_ <= stamp < close else None


def minutes_since_open(
    session: UsEquitySession | Crypto24x7Session, ts: datetime | pd.Timestamp
) -> float | None:
    day = session_of(session, ts)
    if day is None:
        return None
    open_, _ = session_bounds(session, day)
    return (_utc(ts) - open_).value / NS_PER_MINUTE


@dataclass(frozen=True)
class SessionMap:
    ordinal: np.ndarray
    label_ns: np.ndarray
    open_ns: np.ndarray
    close_ns: np.ndarray
    minutes_since_open: np.ndarray
    first_in_session: np.ndarray
    last_in_session: np.ndarray
    reaches_close: np.ndarray
    starts_at_open: np.ndarray
    outside: np.ndarray

    @property
    def size(self) -> int:
        return int(self.ordinal.size)


def _crypto_map(
    session: Crypto24x7Session, ts_ns: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    index = pd.DatetimeIndex(ts_ns.astype("datetime64[ns]")).tz_localize("UTC")
    wall = index.tz_convert(session.timezone).tz_localize(None)
    anchor = pd.Timedelta(hours=session.anchor.hour, minutes=session.anchor.minute)
    labels = (wall - anchor).normalize()
    unique_labels = labels.unique()
    opens = (
        (unique_labels + anchor)
        .tz_localize(session.timezone, nonexistent="shift_forward", ambiguous=True)
        .tz_convert("UTC")
        .as_unit("ns")
        .asi8
    )
    closes = (
        (unique_labels + pd.Timedelta(days=1) + anchor)
        .tz_localize(session.timezone, nonexistent="shift_forward", ambiguous=True)
        .tz_convert("UTC")
        .as_unit("ns")
        .asi8
    )
    position = unique_labels.get_indexer(labels)
    label_ns = labels.as_unit("ns").asi8
    ordinal = label_ns // NS_PER_DAY
    return ordinal, label_ns, opens[position], closes[position]


def _nyse_map(
    ts_ns: np.ndarray, interval_minutes: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    labels, opens, closes = _nyse_arrays()
    if interval_minutes >= 1_440:
        day_ns = ts_ns - ts_ns % NS_PER_DAY
        position = np.searchsorted(labels, day_ns)
        clipped = np.minimum(position, labels.size - 1)
        valid = (position < labels.size) & (labels[clipped] == day_ns)
    else:
        position = np.searchsorted(opens, ts_ns, side="right") - 1
        clipped = np.maximum(position, 0)
        valid = (position >= 0) & (ts_ns < closes[clipped])
    ordinal = np.where(valid, clipped, -1).astype(np.int64)
    label_ns = np.where(valid, labels[clipped], 0)
    open_ns = np.where(valid, opens[clipped], 0)
    close_ns = np.where(valid, closes[clipped], 0)
    return ordinal, label_ns, open_ns, close_ns


def map_sessions(
    session: UsEquitySession | Crypto24x7Session, ts_ns: np.ndarray, interval_minutes: int
) -> SessionMap:
    if isinstance(session, Crypto24x7Session):
        ordinal, label_ns, open_ns, close_ns = _crypto_map(session, ts_ns)
    else:
        if ts_ns.size:
            first = pd.Timestamp(int(ts_ns[0]), tz="UTC").date()
            last = pd.Timestamp(int(ts_ns[-1]), tz="UTC").date()
            _check_nyse_range(first)
            _check_nyse_range(last)
        ordinal, label_ns, open_ns, close_ns = _nyse_map(ts_ns, interval_minutes)
    outside = ordinal < 0
    if interval_minutes >= 1_440 and isinstance(session, UsEquitySession):
        minutes = np.zeros(ts_ns.size, dtype=np.float64)
        bar_end_ns = close_ns
        starts_at_open = ~outside
    else:
        minutes = (ts_ns - open_ns) / NS_PER_MINUTE
        bar_end_ns = ts_ns + interval_minutes * NS_PER_MINUTE
        starts_at_open = ts_ns == open_ns
    change = np.ones(ts_ns.size, dtype=bool)
    change[1:] = ordinal[1:] != ordinal[:-1]
    last = np.ones(ts_ns.size, dtype=bool)
    last[:-1] = change[1:]
    reaches_close = bar_end_ns >= close_ns
    last_in_session = last & ~outside
    if ts_ns.size:
        last_in_session[-1] = bool(reaches_close[-1]) and not bool(outside[-1])
    return SessionMap(
        ordinal=ordinal,
        label_ns=label_ns,
        open_ns=open_ns,
        close_ns=close_ns,
        minutes_since_open=np.where(outside, np.nan, minutes),
        first_in_session=change & ~outside,
        last_in_session=last_in_session,
        reaches_close=reaches_close & ~outside,
        starts_at_open=starts_at_open & ~outside,
        outside=outside,
    )
