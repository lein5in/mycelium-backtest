import numpy as np
import pandas as pd
import pytest

from app.engine import BacktestConfig, run_backtest, validate_bars
from app.engine.models import CostModel, Instrument
from app.engine.sessions import Crypto24x7Session, map_sessions
from app.honesty import random_entries
from app.honesty.config import HonestyConfig
from app.strategies.registry import build_spec
from tests.strategies.helpers import CRYPTO, US, random_crypto, random_us

CONFIG = HonestyConfig()


def donchian_run(seed: int, count: int = 4_000):
    bars = random_crypto(count, seed)
    spec = build_spec(
        "donchian_breakout", {"entry_lookback": 10, "exit_lookback": 5}, "crypto_24x7"
    )
    return bars, spec, run_backtest(bars, spec, CRYPTO)


def test_draws_are_deterministic_given_the_seed():
    bars, spec, output = donchian_run(5)
    trades = output.result.trades
    args = (bars, output.sessions, trades, spec, output.result.warmup_bars, CRYPTO, 200)
    first, _, _ = random_entries.simulate_draws(*args, seed=7)
    second, _, _ = random_entries.simulate_draws(*args, seed=7)
    other, _, _ = random_entries.simulate_draws(*args, seed=8)
    np.testing.assert_array_equal(first, second)
    assert not np.array_equal(first, other)


def test_every_draw_keeps_the_trade_count_and_durations_and_uses_eligible_bars():
    bars, spec, output = donchian_run(6)
    trades = output.result.trades
    warmup = output.result.warmup_bars
    _, layout, unplaced = random_entries.simulate_draws(
        bars, output.sessions, trades, spec, warmup, CRYPTO, 300, 1
    )
    assert unplaced == 0
    durations = layout["durations"]
    assert durations.tolist() == [max(1, trade.bars_held) for trade in trades]
    entries = layout["entries"]
    assert entries.shape == (300, len(trades))
    assert entries.min() >= warmup + 1
    assert (entries + durations[np.newaxis, :] - 1).max() <= bars.size - 1
    assert set(np.unique(layout["sides"]).tolist()) == {-1, 1}


def test_session_end_strategies_hold_random_trades_inside_one_session():
    bars = random_us(30, seed=3, timeframe="5m")
    spec = build_spec("orb", {}, "us_equity")
    output = run_backtest(bars, spec, US)
    trades = output.result.trades
    assert trades
    _, layout, _ = random_entries.simulate_draws(
        bars, output.sessions, trades, spec, output.result.warmup_bars, US, 200, 3
    )
    entries = layout["entries"]
    exits = entries + layout["durations"][np.newaxis, :] - 1
    ordinal = output.sessions.ordinal
    np.testing.assert_array_equal(ordinal[entries - 1], ordinal[exits])


def test_random_trade_pnl_is_hand_computed():
    size = 50
    index = pd.date_range("2024-01-01", periods=size, freq="1h", tz="UTC")
    frame = pd.DataFrame(
        {"open": 100.0, "high": 101.0, "low": 99.5, "close": 101.0, "volume": 1.0}, index=index
    )
    bars = validate_bars(frame, "1h")
    config = BacktestConfig(
        session=Crypto24x7Session(),
        costs=CostModel(fixed_fee=1.0),
        instrument=Instrument(quantity_step=1.0),
        initial_capital=10_050.0,
    )
    spec = build_spec("donchian_breakout", {"directions": "long"}, "crypto_24x7")
    sessions = map_sessions(config.session, bars.ts_ns, bars.interval_minutes)

    class Held:
        bars_held = 1
        entry_price = 100.0
        quantity = 100.0
        net_pnl = 0.0

    totals, layout, _ = random_entries.simulate_draws(
        bars, sessions, [Held()] * 3, spec, 0, config, 100, 1
    )
    assert (layout["sides"] == 1).all()
    np.testing.assert_allclose(totals, 3 * (100 * 1.0 - 2 * 1.0))


@pytest.mark.parametrize(
    ("percentile", "status"),
    [(99.0, "PASS"), (95.0, "PASS"), (94.9, "WARN"), (80.0, "WARN"), (79.9, "FAIL"), (3, "FAIL")],
)
def test_status_thresholds(percentile, status):
    assert random_entries.status_for(percentile, CONFIG) == status


def test_percentile_and_histogram():
    distribution = np.arange(100, dtype=float)
    assert random_entries.percentile_of(50.0, distribution) == pytest.approx(50.5)
    assert random_entries.percentile_of(50.5, distribution) == pytest.approx(51.0)
    assert random_entries.percentile_of(1_000.0, distribution) == 100.0
    histogram = random_entries.histogram(distribution, 150.0, 40)
    assert len(histogram.edges) == 41
    assert sum(histogram.counts) == 100
    assert histogram.edges[-1] == 150.0
    assert histogram.real_bin == 39


def test_evaluate_reports_the_distribution_and_flags_small_samples():
    bars, spec, output = donchian_run(9, count=600)
    trades = output.result.trades
    assert 0 < len(trades) < 30
    check, summary = random_entries.evaluate(
        bars, output.sessions, trades, spec, output.result.warmup_bars, CRYPTO, CONFIG
    )
    assert check.id == "versus_random"
    assert check.insufficient_data
    assert check.status != "PASS"
    assert summary.trades_per_draw == len(trades)
    assert summary.histogram is not None
    assert sum(summary.histogram.counts) == CONFIG.random_draws
    assert summary.p5 <= summary.median <= summary.p95
    assert "does not show" in check.detail


def test_zero_edge_percentiles_spread_across_seeds():
    percentiles = []
    for seed in range(20, 30):
        bars, spec, output = donchian_run(seed, count=3_000)
        _, summary = random_entries.evaluate(
            bars,
            output.sessions,
            output.result.trades,
            spec,
            output.result.warmup_bars,
            CRYPTO,
            HonestyConfig(random_draws=300),
        )
        percentiles.append(summary.percentile)
    top = sum(1 for value in percentiles if value >= 95.0)
    assert top <= 3, percentiles
    assert float(np.median(percentiles)) < 90.0, percentiles
    assert max(percentiles) - min(percentiles) > 20.0, percentiles
