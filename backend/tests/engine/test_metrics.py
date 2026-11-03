import json
import statistics
from datetime import UTC, date, datetime

import numpy as np
import pytest

from app.engine.metrics import (
    calendar,
    compute_metrics,
    daily_equity,
    summarize_trades,
    without_best_trade,
)
from app.engine.results import DailyEquity, RunResult, Trade
from tests.engine.factories import bars, flat
from tests.engine.scripted import scripted_plan
from tests.engine.test_simulation import config, run

EPOCH = datetime(2024, 1, 1, tzinfo=UTC)


def trade(net, exit_session=date(2024, 1, 2), bars_held=1):
    return Trade(
        side="long",
        signal_index=0,
        entry_index=1,
        exit_index=2,
        signal_time=EPOCH,
        entry_time=EPOCH,
        exit_time=EPOCH,
        exit_fill="close",
        session=exit_session,
        exit_session=exit_session,
        quantity=1,
        entry_price=100,
        exit_price=100 + net,
        stop_price=90,
        target_price=None,
        exit_reason="time_exit",
        gross_pnl=net,
        fees=0,
        slippage_cost=0,
        net_pnl=net,
        bars_held=bars_held,
    )


def test_profit_factor_is_null_without_losing_trades():
    assert summarize_trades([10, 20], 1_000).profit_factor is None
    assert summarize_trades([], 1_000).profit_factor is None
    assert summarize_trades([0.0, 5.0], 1_000).profit_factor is None
    assert summarize_trades([30, -10, -5], 1_000).profit_factor == pytest.approx(2.0)


def test_trade_summary_hand_computed():
    summary = summarize_trades([100, -50, -30, 200, -20, -10, 40], 10_000)
    assert summary.trade_count == 7
    assert summary.net_pnl == pytest.approx(230)
    assert summary.return_pct == pytest.approx(2.3)
    assert summary.win_rate_pct == pytest.approx(300 / 7)
    assert summary.average_win == pytest.approx(340 / 3)
    assert summary.average_loss == pytest.approx(-27.5)
    assert summary.expectancy == pytest.approx(230 / 7)
    assert summary.profit_factor == pytest.approx(340 / 110)
    assert summary.longest_losing_streak == 2
    assert summary.realised_max_drawdown == pytest.approx(80)
    assert summary.realised_max_drawdown_pct == pytest.approx(80 / 10_100 * 100)


def test_empty_summary_has_nulls_not_zeros():
    summary = summarize_trades([], 10_000)
    assert summary.trade_count == 0 and summary.net_pnl == 0.0
    assert summary.win_rate_pct is None and summary.expectancy is None
    assert summary.average_win is None and summary.average_loss is None


def test_without_best_trade_removes_one_best_trade():
    trades = [trade(50), trade(300), trade(-40), trade(300)]
    summary = without_best_trade(trades, 10_000)
    assert summary.trade_count == 3
    assert summary.net_pnl == pytest.approx(310)
    assert summary.profit_factor == pytest.approx(350 / 40)


def test_daily_equity_keeps_the_last_bar_of_each_session():
    labels = [date(2024, 1, 1)] * 2 + [date(2024, 1, 2)] * 2
    points = daily_equity(np.array([100.0, 110.0, 99.0, 88.0]), labels, 100.0)
    assert [(p.session, p.equity) for p in points] == [
        (date(2024, 1, 1), 110.0),
        (date(2024, 1, 2), 88.0),
    ]
    assert points[1].drawdown_pct == pytest.approx(20.0)


def daily_points(values, start=date(2024, 1, 1)):
    return [
        DailyEquity(session=date.fromordinal(start.toordinal() + i), equity=v, drawdown_pct=0)
        for i, v in enumerate(values)
    ]


def test_sharpe_uses_daily_returns_and_the_market_annualisation():
    values = [10_100.0, 10_000.0, 10_200.0]
    returns = [0.01, 10_000 / 10_100 - 1, 0.02]
    expected = statistics.mean(returns) / statistics.stdev(returns)
    for days in (252, 365):
        metrics = compute_metrics([], np.array(values), daily_points(values), 10_000, 3, 400, days)
        assert metrics.sharpe == pytest.approx(expected * days**0.5)
        assert metrics.annual_volatility_pct == pytest.approx(
            statistics.stdev(returns) * days**0.5 * 100
        )


def test_annualised_figures_are_null_below_one_year():
    values = [10_100.0, 10_000.0, 10_200.0]
    metrics = compute_metrics([], np.array(values), daily_points(values), 10_000, 3, 364.9, 365)
    assert metrics.sharpe is None and metrics.cagr_pct is None
    assert metrics.annual_volatility_pct is None


def test_cagr_two_years_from_10000_to_12100_is_10_percent():
    values = [11_000.0, 12_100.0]
    metrics = compute_metrics(
        [], np.array(values), daily_points(values), 10_000, 2, 2 * 365.25, 365
    )
    assert metrics.cagr_pct == pytest.approx(10.0)


def test_max_drawdown_is_mark_to_market_from_the_initial_capital():
    equity = np.array([10_500.0, 9_450.0, 10_000.0, 11_000.0])
    metrics = compute_metrics([], equity, daily_points(list(equity)), 10_000, 4, 4, 365)
    assert metrics.max_drawdown == pytest.approx(1_050.0)
    assert metrics.max_drawdown_pct == pytest.approx(10.0)


def test_exposure_is_bars_held_over_all_bars():
    trades = [trade(1, bars_held=3), trade(1, bars_held=2)]
    metrics = compute_metrics(trades, np.full(20, 10_002.0), [], 10_000, 20, 1, 365)
    assert metrics.exposure_pct == pytest.approx(25.0)


def test_weekly_aggregation_crosses_a_month_boundary():
    trades = [
        trade(10, date(2024, 1, 29)),
        trade(-4, date(2024, 1, 31)),
        trade(7, date(2024, 2, 2)),
        trade(1, date(2024, 2, 4)),
        trade(5, date(2024, 2, 5)),
    ]
    result = calendar(trades)
    assert [(b.period, b.net_pnl, b.trades) for b in result.weeks] == [
        ("2024-01-29", 14, 4),
        ("2024-02-05", 5, 1),
    ]
    assert [(b.period, b.net_pnl, b.trades) for b in result.months] == [
        ("2024-01", 6, 2),
        ("2024-02", 13, 3),
    ]
    assert [b.period for b in result.days] == [
        "2024-01-29",
        "2024-01-31",
        "2024-02-02",
        "2024-02-04",
        "2024-02-05",
    ]


def test_run_result_serialises_to_json_with_schema_version():
    rows = [flat(100), (100, 106, 99, 104), flat(100)]
    result = run(rows, scripted_plan(3, longs={0: (95, 105)}), config())
    payload = json.loads(result.model_dump_json())
    assert payload["schema_version"] == 1
    assert payload["metrics"]["summary"]["profit_factor"] is None
    assert RunResult.model_validate_json(result.model_dump_json()) == result
    assert any("stop is assumed hit first" in line for line in result.assumptions)
    assert bars(rows).size == 3
