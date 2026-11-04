from collections.abc import Sequence
from datetime import date, timedelta

import pandas as pd

from app.engine.results import Trade
from app.engine.sessions import (
    NYSE_TIMEZONE,
    Crypto24x7Session,
    MarketSession,
    SessionMap,
    nyse_calendar,
)
from app.honesty.model import CalendarDay, CalendarMonth, CalendarWeek, DayKind, PnlCalendar

RULE = (
    "Each trade counts on the session date of its exit bar, in the market's session time "
    "zone (New York for US stocks; the configured anchor and time zone for crypto). Days "
    "without a session, and session days outside the data, are left empty, not zero."
)


def _empty(day: date, kind: DayKind) -> CalendarDay:
    return CalendarDay(date=day, kind=kind, net_pnl=None, trades=None)


def _months(first: date, last: date) -> list[tuple[int, int]]:
    months = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        months.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def _month_end(year: int, month: int) -> date:
    following = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return following - timedelta(days=1)


def _open_days(session: MarketSession, first: date, last: date) -> set[date] | None:
    if isinstance(session, Crypto24x7Session):
        return None
    labels = nyse_calendar().sessions_in_range(pd.Timestamp(first), pd.Timestamp(last))
    return {label.date() for label in labels}


def build(trades: Sequence[Trade], sessions: SessionMap, session: MarketSession) -> PnlCalendar:
    labels = pd.DatetimeIndex(pd.unique(sessions.label_ns).astype("datetime64[ns]"))
    present = set(labels.date.tolist())
    pnl: dict[date, float] = {}
    count: dict[date, int] = {}
    for trade in trades:
        pnl[trade.exit_session] = pnl.get(trade.exit_session, 0.0) + trade.net_pnl
        count[trade.exit_session] = count.get(trade.exit_session, 0) + 1
    timezone = session.timezone if isinstance(session, Crypto24x7Session) else NYSE_TIMEZONE
    if not present:
        return PnlCalendar(rule=RULE, timezone=timezone, months=[])
    first, last = min(present), max(present)
    span_start = date(first.year, first.month, 1)
    span_end = _month_end(last.year, last.month)
    open_days = _open_days(session, span_start, span_end)
    months = []
    for year, month in _months(first, last):
        start = date(year, month, 1)
        end = _month_end(year, month)
        monday = start - timedelta(days=start.weekday())
        weeks = []
        while monday <= end:
            days = []
            for offset in range(7):
                day = monday + timedelta(days=offset)
                if not start <= day <= end:
                    days.append(_empty(day, "other_month"))
                elif day in present:
                    days.append(
                        CalendarDay(
                            date=day,
                            kind="session",
                            net_pnl=pnl.get(day, 0.0),
                            trades=count.get(day, 0),
                        )
                    )
                elif open_days is not None and day not in open_days:
                    days.append(_empty(day, "closed"))
                else:
                    days.append(_empty(day, "no_data"))
            weeks.append(
                CalendarWeek(
                    monday=monday,
                    days=days,
                    net_pnl=sum(d.net_pnl or 0.0 for d in days),
                    trades=sum(d.trades or 0 for d in days),
                )
            )
            monday += timedelta(days=7)
        traded = [d for week in weeks for d in week.days if d.trades]
        best = max(traded, key=lambda d: (d.net_pnl, d.date), default=None)
        worst = min(traded, key=lambda d: (d.net_pnl, d.date), default=None)
        active = [week for week in weeks if week.trades]
        months.append(
            CalendarMonth(
                month=f"{year:04d}-{month:02d}",
                weeks=weeks,
                net_pnl=sum(week.net_pnl for week in weeks),
                trades=sum(week.trades for week in weeks),
                green_weeks=sum(1 for week in active if week.net_pnl > 0),
                weeks_with_trades=len(active),
                best_day=best.date if best else None,
                best_day_pnl=best.net_pnl if best else None,
                worst_day=worst.date if worst else None,
                worst_day_pnl=worst.net_pnl if worst else None,
            )
        )
    return PnlCalendar(rule=RULE, timezone=timezone, months=months)
