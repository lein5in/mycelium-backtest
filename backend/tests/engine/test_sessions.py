from datetime import date, time

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from app.engine.sessions import (
    Crypto24x7Session,
    SessionError,
    UsEquitySession,
    is_trading_session,
    map_sessions,
    minutes_since_open,
    session_bounds,
    session_of,
)

US = UsEquitySession()


def utc(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz="UTC")


def ns(index: pd.DatetimeIndex) -> np.ndarray:
    return index.as_unit("ns").asi8


def test_christmas_eve_2021_is_closed_without_exception():
    assert is_trading_session(US, date(2021, 12, 24)) is False
    assert session_of(US, utc("2021-12-24 15:00")) is None
    with pytest.raises(SessionError, match="not an NYSE trading session"):
        session_bounds(US, date(2021, 12, 24))
    mapped = map_sessions(
        US, ns(pd.date_range("2021-12-24 14:30", periods=3, freq="1h", tz="UTC")), 60
    )
    assert mapped.outside.all()


def test_early_close_2024_12_24_closes_at_13_00_new_york():
    open_, close = session_bounds(US, date(2024, 12, 24))
    assert open_.tz_convert("America/New_York").strftime("%H:%M") == "09:30"
    assert close.tz_convert("America/New_York").strftime("%H:%M") == "13:00"
    assert (open_, close) == (utc("2024-12-24 14:30"), utc("2024-12-24 18:00"))


@pytest.mark.parametrize(
    ("day", "open_utc", "close_utc"),
    [
        (date(2024, 3, 8), "2024-03-08 14:30", "2024-03-08 21:00"),
        (date(2024, 3, 11), "2024-03-11 13:30", "2024-03-11 20:00"),
        (date(2024, 11, 1), "2024-11-01 13:30", "2024-11-01 20:00"),
        (date(2024, 11, 4), "2024-11-04 14:30", "2024-11-04 21:00"),
    ],
)
def test_us_daylight_saving_transitions(day, open_utc, close_utc):
    assert session_bounds(US, day) == (utc(open_utc), utc(close_utc))


def test_session_of_and_minutes_since_open_on_early_close_day():
    assert session_of(US, utc("2024-12-24 14:30")) == date(2024, 12, 24)
    assert session_of(US, utc("2024-12-24 17:59")) == date(2024, 12, 24)
    assert session_of(US, utc("2024-12-24 18:00")) is None
    assert session_of(US, utc("2024-12-24 14:29")) is None
    assert minutes_since_open(US, utc("2024-12-24 15:00")) == 30.0


def test_first_and_last_bar_of_each_session_in_a_series():
    first_day = pd.date_range("2024-12-23 14:30", "2024-12-23 20:30", freq="30min", tz="UTC")
    early_day = pd.date_range("2024-12-24 14:30", "2024-12-24 17:30", freq="30min", tz="UTC")
    index = first_day.append(early_day)
    mapped = map_sessions(US, ns(index), 30)
    assert len(first_day) == 13 and len(early_day) == 7
    assert not mapped.outside.any()
    assert np.flatnonzero(mapped.first_in_session).tolist() == [0, 13]
    assert np.flatnonzero(mapped.last_in_session).tolist() == [12, 19]
    assert mapped.minutes_since_open[13:16].tolist() == [0.0, 30.0, 60.0]
    assert mapped.ordinal[13] == mapped.ordinal[12] + 1


def test_holiday_does_not_break_session_ordinals():
    index = pd.DatetimeIndex([utc("2021-12-23 15:00"), utc("2021-12-27 15:00")])
    mapped = map_sessions(US, ns(index), 60)
    assert mapped.ordinal[1] - mapped.ordinal[0] == 1


def test_truncated_final_session_has_no_last_bar():
    index = pd.date_range("2024-12-23 14:30", periods=4, freq="30min", tz="UTC")
    mapped = map_sessions(US, ns(index), 30)
    assert not mapped.last_in_session.any()


def test_us_daily_bars_map_by_date():
    index = pd.DatetimeIndex([utc("2024-12-23"), utc("2024-12-24"), utc("2024-12-26")])
    mapped = map_sessions(US, ns(index), 1_440)
    assert not mapped.outside.any()
    assert mapped.last_in_session.all() and mapped.first_in_session.all()
    assert mapped.minutes_since_open.tolist() == [0.0, 0.0, 0.0]
    closed = map_sessions(US, ns(pd.DatetimeIndex([utc("2024-12-25")])), 1_440)
    assert closed.outside.all()


def test_crypto_default_anchor_is_midnight_utc():
    crypto = Crypto24x7Session()
    assert crypto.anchor == time(0, 0) and crypto.timezone == "UTC"
    assert session_bounds(crypto, date(2024, 1, 1)) == (
        utc("2024-01-01 00:00"),
        utc("2024-01-02 00:00"),
    )
    assert is_trading_session(crypto, date(2024, 12, 25))


def test_bar_exactly_at_the_anchor_belongs_to_the_new_session():
    crypto = Crypto24x7Session()
    assert session_of(crypto, utc("2024-01-01 23:59")) == date(2024, 1, 1)
    assert session_of(crypto, utc("2024-01-02 00:00")) == date(2024, 1, 2)
    index = pd.date_range("2024-01-01 22:00", periods=4, freq="1h", tz="UTC")
    mapped = map_sessions(crypto, ns(index), 60)
    assert np.flatnonzero(mapped.first_in_session).tolist() == [0, 2]
    assert mapped.last_in_session.tolist() == [False, True, False, False]


def test_crypto_anchor_in_a_non_utc_timezone_across_dst():
    paris = Crypto24x7Session(anchor=time(9, 0), timezone="Europe/Paris")
    assert session_bounds(paris, date(2024, 3, 30)) == (
        utc("2024-03-30 08:00"),
        utc("2024-03-31 07:00"),
    )
    assert session_of(paris, utc("2024-03-31 06:59")) == date(2024, 3, 30)
    assert session_of(paris, utc("2024-03-31 07:00")) == date(2024, 3, 31)
    index = pd.date_range("2024-03-30 07:00", periods=26, freq="1h", tz="UTC")
    mapped = map_sessions(paris, ns(index), 60)
    assert np.flatnonzero(mapped.first_in_session).tolist() == [0, 1, 24]
    assert mapped.minutes_since_open[24] == 0.0


def test_new_york_anchor_for_crypto():
    new_york = Crypto24x7Session(anchor=time(17, 0), timezone="America/New_York")
    assert session_bounds(new_york, date(2024, 7, 1)) == (
        utc("2024-07-01 21:00"),
        utc("2024-07-02 21:00"),
    )
    assert session_of(new_york, utc("2024-07-01 20:59")) == date(2024, 6, 30)


def test_invalid_crypto_session_definitions_are_rejected():
    with pytest.raises(ValidationError, match="unknown timezone"):
        Crypto24x7Session(timezone="Mars/Olympus")
    with pytest.raises(ValidationError, match="to the minute"):
        Crypto24x7Session(anchor=time(0, 0, 30))
    with pytest.raises(ValidationError):
        Crypto24x7Session.model_validate({"kind": "crypto_24x7", "extra": 1})


def test_naive_timestamps_are_rejected():
    with pytest.raises(SessionError, match="timezone-aware"):
        session_of(US, pd.Timestamp("2024-01-02 15:00"))


def test_dates_outside_the_calendar_range_raise_a_clear_error():
    with pytest.raises(SessionError, match="outside the supported NYSE calendar range"):
        is_trading_session(US, date(1980, 1, 2))
