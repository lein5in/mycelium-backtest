from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.engine.backtest import run_plan
from app.engine.models import BacktestConfig, CostModel, Instrument, SlippageTicks
from app.engine.sessions import Crypto24x7Session
from app.honesty import best_trade, costs, out_of_sample, periods, robustness, trade_count
from app.honesty.config import HonestyConfig
from app.honesty.costs import CostFigures, scaled_costs
from app.honesty.model import ParameterPart
from tests.engine.factories import bars, flat
from tests.engine.scripted import scripted_plan

CONFIG = HonestyConfig()
CAPITAL = 10_000.0


def figures(gross, fees, slippage, scaled, count=50):
    return CostFigures(
        trade_count=count,
        gross_pnl=gross,
        fees=fees,
        slippage=slippage,
        net_pnl=gross - fees - slippage,
        net_zero_cost=gross,
        net_scaled_cost=scaled,
        multiplier=2.0,
    )


@pytest.mark.parametrize(
    ("case", "status", "share"),
    [
        (figures(1_000, 200, 100, 400), "PASS", 0.3),
        (figures(1_000, 300, 150, -10), "WARN", 0.45),
        (figures(1_000, 400, 200, 50), "WARN", 0.6),
        (figures(1_000, 700, 300, -800), "FAIL", 1.0),
        (figures(1_000, 600, 250, -600), "FAIL", 0.85),
        (figures(-100, 50, 20, -240), "FAIL", None),
    ],
)
def test_costs_statuses(case, status, share):
    check = costs.evaluate(case, CONFIG)
    assert check.status == status
    assert check.insufficient_data is False
    assert check.measured["cost_share_of_gross"] == pytest.approx(share)
    assert check.measured["net_pnl"] == case.net_pnl
    assert check.measured["net_pnl_scaled_cost"] == case.net_scaled_cost


def test_costs_without_trades_is_insufficient_and_never_pass():
    check = costs.evaluate(figures(0, 0, 0, 0, count=0), CONFIG)
    assert check.status == "WARN"
    assert check.insufficient_data


def test_scaled_costs_doubles_every_component_and_zeroes():
    model = CostModel(fee_pct=0.1, fixed_fee=1.5, slippage=SlippageTicks(value=2))
    doubled = scaled_costs(model, 2.0)
    assert (doubled.fee_pct, doubled.fixed_fee, doubled.slippage.value) == (0.2, 3.0, 4.0)
    zero = scaled_costs(model, 0.0)
    assert (zero.fee_pct, zero.fixed_fee, zero.slippage.value) == (0.0, 0.0, 0.0)
    assert scaled_costs(CostModel(fee_pct=4), 2.0).fee_pct == 8.0


def test_costs_measure_reruns_the_same_trades_with_other_costs():
    series = bars([flat(100), (100, 105, 99, 104), (104, 111, 103, 110)])
    config = BacktestConfig(
        session=Crypto24x7Session(),
        costs=CostModel(fixed_fee=1.0),
        instrument=Instrument(quantity_step=1.0),
        initial_capital=10_050.0,
    )
    plan = scripted_plan(series.size, longs={0: (90.0, None)})
    output = run_plan(series, plan, config, "scripted")
    trades = output.result.trades
    assert [trade.quantity for trade in trades] == [100.0]
    result = costs.measure(series, output.sessions, plan, config, "scripted", trades, 2.0)
    assert result.gross_pnl == pytest.approx(1_000.0)
    assert result.fees == pytest.approx(2.0)
    assert result.net_pnl == pytest.approx(998.0)
    assert result.net_zero_cost == pytest.approx(1_000.0)
    assert result.net_scaled_cost == pytest.approx(996.0)


@pytest.mark.parametrize(
    ("count", "status", "insufficient", "split"),
    [
        (120, "PASS", False, (84, 36)),
        (100, "PASS", False, (70, 30)),
        (99, "WARN", False, (69, 30)),
        (60, "WARN", True, (42, 18)),
        (30, "WARN", True, (21, 9)),
        (29, "FAIL", True, (20, 9)),
        (0, "FAIL", True, (0, 0)),
    ],
)
def test_trade_count(count, status, insufficient, split):
    check = trade_count.evaluate(count, CONFIG)
    assert check.status == status
    assert check.insufficient_data is insufficient
    assert (check.measured["first_part_trades"], check.measured["last_part_trades"]) == split


def trades_of(pnls):
    return [SimpleNamespace(net_pnl=float(value)) for value in pnls]


@pytest.mark.parametrize(
    ("pnls", "status", "without", "pf", "share"),
    [
        ([30, 20, -10] * 10, "PASS", 370.0, 470 / 100, 30 / 400),
        ([10] * 30, "PASS", 290.0, None, 10 / 300),
        ([500] + [100] * 15 + [-105] * 14, "WARN", 30.0, 1500 / 1470, 500 / 530),
        ([300] + [100] * 15 + [-80] * 14, "WARN", 380.0, 1500 / 1120, 300 / 680),
        ([1_000] + [10] * 15 + [-20] * 14, "FAIL", -130.0, 150 / 280, 1000 / 870),
    ],
)
def test_without_best_trade(pnls, status, without, pf, share):
    check = best_trade.evaluate(trades_of(pnls), CAPITAL, CONFIG)
    assert check.status == status
    assert check.insufficient_data is False
    assert check.measured["net_pnl_without_best"] == pytest.approx(without)
    assert check.measured["profit_factor_without_best"] == pytest.approx(pf)
    assert check.measured["best_trade_share_of_net"] == pytest.approx(share)


def test_without_best_trade_small_sample_is_insufficient():
    check = best_trade.evaluate(trades_of([30, 20, 30, 20, -10]), CAPITAL, CONFIG)
    assert check.status == "WARN"
    assert check.insufficient_data


def test_without_best_trade_no_trades_fails():
    check = best_trade.evaluate([], CAPITAL, CONFIG)
    assert check.status == "FAIL"
    assert check.insufficient_data


def alternate(win, loss, count):
    return [win if i % 2 == 0 else loss for i in range(count)]


@pytest.mark.parametrize(
    ("pnls", "status", "first_net", "last_net", "ratio"),
    [
        (alternate(10, -5, 70) + alternate(10, -5, 30), "PASS", 175.0, 75.0, 1.0),
        (alternate(10, -5, 70) + alternate(10, -8, 30), "WARN", 175.0, 30.0, 1.25 / 2),
        (alternate(10, -5, 70) + [-5] * 30, "FAIL", 175.0, -150.0, 0.0),
        (alternate(5, -10, 70) + alternate(5, -10, 30), "FAIL", -175.0, -75.0, 1.0),
    ],
)
def test_out_of_sample(pnls, status, first_net, last_net, ratio):
    check = out_of_sample.evaluate(pnls, CAPITAL, CONFIG)
    assert check.status == status
    assert check.insufficient_data is False
    assert check.measured["first_trades"] == 70
    assert check.measured["last_trades"] == 30
    assert check.measured["first_net_pnl"] == pytest.approx(first_net)
    assert check.measured["last_net_pnl"] == pytest.approx(last_net)
    assert check.measured["profit_factor_ratio"] == pytest.approx(ratio)


def test_out_of_sample_small_split_is_insufficient():
    check = out_of_sample.evaluate(alternate(10, -5, 50), CAPITAL, CONFIG)
    assert (check.measured["first_trades"], check.measured["last_trades"]) == (35, 15)
    assert check.status == "WARN"
    assert check.insufficient_data


def block_pnls(nets, per_block=10):
    return [net / per_block for net in nets for _ in range(per_block)]


def times(count):
    start = datetime(2024, 1, 1, tzinfo=UTC)
    return [start + timedelta(hours=i) for i in range(count)]


@pytest.mark.parametrize(
    ("nets", "status", "max_share", "positive"),
    [
        ([25, 25, 25, 25], "PASS", 0.25, 1.0),
        ([60, 20, 10, 10], "WARN", 0.6, 1.0),
        ([90, 5, 3, 2], "FAIL", 0.9, 1.0),
        ([0, -10, 0, 0], "FAIL", None, 0.0),
    ],
)
def test_period_blocks(nets, status, max_share, positive):
    pnls = block_pnls(nets)
    part = periods.evaluate(pnls, times(len(pnls)), CONFIG)
    assert part.status == status
    assert part.insufficient_data is False
    assert [block.trade_count for block in part.blocks] == [10, 10, 10, 10]
    assert [block.net_pnl for block in part.blocks] == pytest.approx(nets)
    assert part.max_share == pytest.approx(max_share)
    assert part.positive_fraction == pytest.approx(positive)


def test_period_blocks_fail_when_fewer_than_half_are_positive():
    config = HonestyConfig(period_blocks=5)
    pnls = block_pnls([60, 60, -10, -5, -5])
    part = periods.evaluate(pnls, times(len(pnls)), config)
    assert part.max_share == pytest.approx(0.6)
    assert part.positive_fraction == pytest.approx(0.4)
    assert part.status == "FAIL"


def test_period_blocks_shrink_and_flag_small_samples():
    pnls = [1.0] * 25
    part = periods.evaluate(pnls, times(25), CONFIG)
    assert len(part.blocks) == 2
    assert part.status == "WARN"
    assert part.insufficient_data
    single = periods.evaluate([1.0] * 9, times(9), CONFIG)
    assert len(single.blocks) == 1
    assert single.status == "WARN"
    assert single.insufficient_data


def test_robustness_is_the_worse_part():
    pnls = block_pnls([25, 25, 25, 25])
    period = periods.evaluate(pnls, times(len(pnls)), CONFIG)
    alone, _ = robustness.evaluate(
        period, ParameterPart(status="not_run", insufficient_data=False, reason="skipped."), CONFIG
    )
    assert alone.status == "PASS"
    assert "periods only" in alone.detail
    failed, _ = robustness.evaluate(
        period, ParameterPart(status="FAIL", insufficient_data=False, reason="spike."), CONFIG
    )
    assert failed.status == "FAIL"
    thin, _ = robustness.evaluate(
        period, ParameterPart(status="PASS", insufficient_data=True, reason="few."), CONFIG
    )
    assert thin.status == "WARN"
    assert thin.insufficient_data
