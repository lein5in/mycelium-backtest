from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from app.engine.sessions import Crypto24x7Session, UsEquitySession, map_sessions
from app.honesty import calendar
from tests.strategies.helpers import random_us


def trade(day: str, pnl: float):
    return SimpleNamespace(exit_session=date.fromisoformat(day), net_pnl=pnl)


def daily_sessions(first: str, last: str):
    index = pd.date_range(first, last, freq="1D", tz="UTC")
    return map_sessions(Crypto24x7Session(), index.as_unit("ns").asi8, 1_440)


def day_of(month, iso):
    return next(d for week in month.weeks for d in week.days if d.date.isoformat() == iso)


def test_month_and_year_boundary_with_a_week_without_trades():
    sessions = daily_sessions("2024-12-20", "2025-01-10")
    trades = [
        trade("2024-12-23", 10.0),
        trade("2024-12-23", -4.0),
        trade("2024-12-31", 5.0),
        trade("2025-01-02", -3.0),
        trade("2025-01-09", 7.0),
    ]
    result = calendar.build(trades, sessions, Crypto24x7Session())
    assert result.timezone == "UTC"
    assert "exit" in result.rule
    december, january = result.months
    assert december.month == "2024-12"
    assert [week.monday.isoformat() for week in december.weeks] == [
        "2024-11-25",
        "2024-12-02",
        "2024-12-09",
        "2024-12-16",
        "2024-12-23",
        "2024-12-30",
    ]
    assert all(len(week.days) == 7 for week in december.weeks)
    assert december.net_pnl == pytest.approx(11.0)
    assert december.trades == 3
    assert (december.green_weeks, december.weeks_with_trades) == (2, 2)
    assert (december.best_day, december.best_day_pnl) == (date(2024, 12, 23), 6.0)
    assert (december.worst_day, december.worst_day_pnl) == (date(2024, 12, 31), 5.0)
    quiet_week = december.weeks[3]
    assert quiet_week.trades == 0
    assert quiet_week.net_pnl == 0.0
    assert [d.kind for d in quiet_week.days] == ["no_data"] * 4 + ["session"] * 3
    assert day_of(december, "2024-12-21").net_pnl == 0.0
    assert day_of(december, "2024-12-19").net_pnl is None
    assert day_of(december, "2024-11-30").kind == "other_month"
    edge_week = december.weeks[5]
    assert [d.kind for d in edge_week.days] == ["session"] * 2 + ["other_month"] * 5
    assert edge_week.net_pnl == pytest.approx(5.0)

    assert january.month == "2025-01"
    assert len(january.weeks) == 5
    assert january.weeks[0].monday == date(2024, 12, 30)
    assert january.weeks[0].net_pnl == pytest.approx(-3.0)
    assert day_of(january, "2025-01-01").net_pnl == 0.0
    assert day_of(january, "2025-01-01").trades == 0
    assert day_of(january, "2025-01-11").kind == "no_data"
    assert january.net_pnl == pytest.approx(4.0)
    assert (january.green_weeks, january.weeks_with_trades) == (1, 2)
    assert (january.best_day, january.worst_day) == (date(2025, 1, 9), date(2025, 1, 2))


def test_us_market_days_without_a_session_are_closed_not_zero():
    bars = random_us(8, seed=1, timeframe="30m", first="2024-12-20")
    sessions = map_sessions(UsEquitySession(), bars.ts_ns, bars.interval_minutes)
    result = calendar.build([trade("2024-12-24", 12.5)], sessions, UsEquitySession())
    assert result.timezone == "America/New_York"
    december = result.months[0]
    assert day_of(december, "2024-12-24").net_pnl == 12.5
    christmas = day_of(december, "2024-12-25")
    assert (christmas.kind, christmas.net_pnl, christmas.trades) == ("closed", None, None)
    assert day_of(december, "2024-12-28").kind == "closed"
    assert day_of(december, "2024-12-26").kind == "session"
    assert day_of(december, "2024-12-26").net_pnl == 0.0
    assert day_of(december, "2024-12-02").kind == "no_data"


def test_crypto_anchor_moves_the_session_date():
    session = Crypto24x7Session(anchor="17:00", timezone="America/New_York")
    index = pd.date_range("2024-03-01", periods=24 * 5, freq="1h", tz="UTC")
    sessions = map_sessions(session, index.as_unit("ns").asi8, 60)
    result = calendar.build([], sessions, session)
    assert result.timezone == "America/New_York"
    first = result.months[0]
    assert first.month == "2024-02"
    assert day_of(first, "2024-02-29").kind == "session"
    assert first.trades == 0
    assert first.best_day is None
