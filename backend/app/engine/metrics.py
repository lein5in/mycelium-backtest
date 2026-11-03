import math
from collections.abc import Sequence
from datetime import date, timedelta

import numpy as np

from app.engine.results import (
    Calendar,
    CalendarBucket,
    DailyEquity,
    Metrics,
    Trade,
    TradeSummary,
)

DAYS_PER_YEAR = 365.25
MINIMUM_PERIOD_DAYS = 365.0


def _drawdown(curve: np.ndarray, initial_capital: float) -> tuple[float, float]:
    path = np.concatenate([[initial_capital], curve])
    peaks = np.maximum.accumulate(path)
    amounts = peaks - path
    with np.errstate(divide="ignore", invalid="ignore"):
        percents = np.where(peaks > 0, amounts / peaks * 100.0, 0.0)
    return float(percents.max()), float(amounts.max())


def summarize_trades(net_pnls: Sequence[float], initial_capital: float) -> TradeSummary:
    values = np.asarray(net_pnls, dtype=np.float64)
    count = int(values.size)
    wins = values[values > 0]
    losses = values[values < 0]
    streak = 0
    longest = 0
    for value in values.tolist():
        streak = streak + 1 if value < 0 else 0
        longest = max(longest, streak)
    net = float(values.sum()) if count else 0.0
    drawdown_pct, drawdown = _drawdown(initial_capital + np.cumsum(values), initial_capital)
    return TradeSummary(
        trade_count=count,
        net_pnl=net,
        return_pct=net / initial_capital * 100.0,
        win_rate_pct=float(wins.size / count * 100.0) if count else None,
        average_win=float(wins.mean()) if wins.size else None,
        average_loss=float(losses.mean()) if losses.size else None,
        expectancy=float(values.mean()) if count else None,
        profit_factor=float(wins.sum() / -losses.sum()) if losses.size else None,
        longest_losing_streak=longest,
        realised_max_drawdown_pct=drawdown_pct,
        realised_max_drawdown=drawdown,
    )


def without_best_trade(trades: Sequence[Trade], initial_capital: float) -> TradeSummary:
    pnls = [trade.net_pnl for trade in trades]
    if pnls:
        pnls.pop(int(np.argmax(pnls)))
    return summarize_trades(pnls, initial_capital)


def daily_equity(
    equity: np.ndarray, session_labels: Sequence[date], initial_capital: float
) -> list[DailyEquity]:
    points: list[DailyEquity] = []
    peak = initial_capital
    values = equity.tolist()
    for i, label in enumerate(session_labels):
        if i + 1 < len(session_labels) and session_labels[i + 1] == label:
            continue
        value = values[i]
        peak = max(peak, value)
        points.append(
            DailyEquity(
                session=label,
                equity=value,
                drawdown_pct=(peak - value) / peak * 100.0 if peak > 0 else 0.0,
            )
        )
    return points


def compute_metrics(
    trades: Sequence[Trade],
    equity: np.ndarray,
    daily: Sequence[DailyEquity],
    initial_capital: float,
    bar_count: int,
    period_days: float,
    annualisation_days: int,
) -> Metrics:
    summary = summarize_trades([trade.net_pnl for trade in trades], initial_capital)
    drawdown_pct, drawdown = _drawdown(equity, initial_capital)
    final_equity = float(equity[-1]) if equity.size else initial_capital
    held = sum(trade.bars_held for trade in trades)
    sharpe = None
    cagr = None
    volatility = None
    if period_days >= MINIMUM_PERIOD_DAYS:
        closes = np.array([initial_capital, *[point.equity for point in daily]])
        returns = closes[1:] / closes[:-1] - 1.0
        if returns.size >= 2:
            deviation = float(returns.std(ddof=1))
            if deviation > 0:
                sharpe = float(returns.mean() / deviation * math.sqrt(annualisation_days))
                volatility = deviation * math.sqrt(annualisation_days) * 100.0
        if final_equity > 0:
            cagr = ((final_equity / initial_capital) ** (DAYS_PER_YEAR / period_days) - 1) * 100
    return Metrics(
        summary=summary,
        initial_capital=initial_capital,
        final_equity=final_equity,
        max_drawdown_pct=drawdown_pct,
        max_drawdown=drawdown,
        exposure_pct=held / bar_count * 100.0 if bar_count else 0.0,
        sharpe=sharpe,
        cagr_pct=cagr,
        annual_volatility_pct=volatility,
        annualisation_days=annualisation_days,
        period_days=period_days,
    )


def _buckets(pairs: list[tuple[str, float]]) -> list[CalendarBucket]:
    totals: dict[str, list[float]] = {}
    for key, pnl in pairs:
        bucket = totals.setdefault(key, [0.0, 0])
        bucket[0] += pnl
        bucket[1] += 1
    return [
        CalendarBucket(period=key, net_pnl=total, trades=int(count))
        for key, (total, count) in sorted(totals.items())
    ]


def calendar(trades: Sequence[Trade]) -> Calendar:
    days = [(trade.exit_session.isoformat(), trade.net_pnl) for trade in trades]
    weeks = [
        (
            (trade.exit_session - timedelta(days=trade.exit_session.weekday())).isoformat(),
            trade.net_pnl,
        )
        for trade in trades
    ]
    months = [(trade.exit_session.strftime("%Y-%m"), trade.net_pnl) for trade in trades]
    return Calendar(days=_buckets(days), weeks=_buckets(weeks), months=_buckets(months))
