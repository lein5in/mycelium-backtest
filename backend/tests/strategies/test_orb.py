import pytest

from app.engine import IncompatibleMarketError
from app.strategies import orb
from app.strategies.params import ParameterError
from tests.strategies.helpers import (
    CRYPTO,
    US,
    assert_no_look_ahead,
    crypto_bars,
    quiet,
    random_crypto,
    random_us,
    run,
    trade_tuple,
)

PREFIX = [quiet()] * 24
RANGE = [(100, 101, 99, 100)] * 6
START = "2024-01-01 22:00"


def spec(**values):
    return orb.STRATEGY.spec(values, "crypto_24x7")


def series(*tail):
    return crypto_bars(PREFIX + RANGE + list(tail) + [quiet(100)] * 3, START)


def test_long_breakout_hits_the_1_5_r_target():
    bars = series((100, 101.7, 99.9, 101.5), (101.6, 102, 101.4, 101.8), (101.8, 105.6, 101.7, 105))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 31, 101.6, "target", pytest.approx(98 * 3.9 - 2))
    ]
    assert trades[0].stop_price == 99 and trades[0].exit_price == pytest.approx(105.5)


def test_short_breakout_hits_the_target():
    bars = series((100, 100.1, 98.3, 98.5), (98.4, 98.6, 98, 98.2), (98.2, 98.3, 94.4, 95))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("short", 31, 98.4, "target", pytest.approx(101 * 3.9 - 2))
    ]
    assert trades[0].stop_price == 101 and trades[0].exit_price == pytest.approx(94.5)


def test_no_breakout_no_trade():
    bars = series(*[(100, 100.8, 99.2, 100)] * 6)
    assert run(spec(), bars, CRYPTO).trades == []


def test_long_breakout_stopped_at_the_range_low():
    bars = series((100, 101.7, 99.9, 101.5), (101.6, 102, 101.4, 101.8), (101.8, 101.9, 98.9, 99.2))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 31, 101.6, "stop", pytest.approx(98 * -2.6 - 2))
    ]


def test_time_exit_at_the_last_bar_of_the_crypto_session():
    tail = [(100, 101.7, 99.9, 101.5), (101.6, 102, 101.4, 101.8)]
    tail += [(102, 103.2, 101.9, 103)] * (288 - 6 - 2)
    bars = crypto_bars(PREFIX + RANGE + tail + [quiet(103)], START)
    trade = run(spec(target_r=0.0, directions="long"), bars, CRYPTO).trades[0]
    assert (trade.exit_index, trade.exit_reason, trade.exit_fill) == (311, "time_exit", "close")
    assert trade.exit_time.isoformat() == "2024-01-02T23:55:00+00:00"
    assert trade.net_pnl == pytest.approx(98 * 1.4 - 2)


def test_narrow_range_is_filtered_by_the_atr_multiple():
    narrow = [(100, 100.1, 99.9, 100)] * 6
    tail = [(100, 100.6, 99.95, 100.5), (100.5, 100.7, 100.4, 100.6)] + [quiet(100.6, 0.1)] * 3
    bars = crypto_bars(PREFIX + narrow + tail, START)
    assert run(spec(), bars, CRYPTO).trades == []
    assert len(run(spec(min_range_atr=0.0), bars, CRYPTO).trades) == 1


def test_long_only_ignores_a_short_breakout():
    bars = series((100, 100.1, 98.3, 98.5), (98.4, 98.6, 98, 98.2), (98.2, 98.3, 94.4, 95))
    assert run(spec(directions="long"), bars, CRYPTO).trades == []


def test_no_trade_before_atr_warmup_in_the_first_session():
    bars = crypto_bars(
        RANGE + [(100, 101.7, 99.9, 101.5), (101.6, 102, 101.4, 101.8)] + [quiet(102)] * 4,
        "2024-01-02 00:00",
    )
    result = run(spec(), bars, CRYPTO)
    assert result.trades == [] and result.warmup_bars == 14
    assert run(spec(min_range_atr=0.0), bars, CRYPTO).warmup_bars == 0


def test_range_must_be_a_multiple_of_the_bar_interval():
    bars = random_crypto(300, 1, timeframe="1h")
    with pytest.raises(ValueError, match="whole multiple"):
        run(spec(), bars, CRYPTO)


@pytest.mark.parametrize("k", [400, 900, 1_500])
def test_no_look_ahead_on_us_equity(k):
    bars = random_us(25, seed=3)
    trades = assert_no_look_ahead(spec(), bars, US, k)
    assert len(trades) >= 5


def test_no_look_ahead_on_crypto():
    bars = random_crypto(3_000, seed=4, timeframe="5m")
    assert assert_no_look_ahead(spec(), bars, CRYPTO, 1_800)


def test_determinism_and_one_trade_per_session():
    bars = random_us(25, seed=5)
    first = run(spec(), bars, US)
    assert first.model_dump() == run(spec(), bars, US).model_dump()
    sessions = [t.session for t in first.trades]
    assert len(sessions) == len(set(sessions)) > 3


def test_defaults_are_valid_and_out_of_range_values_are_rejected():
    assert orb.STRATEGY.validate(None, "us_equity") == {
        "range_minutes": 30,
        "min_range_atr": 0.5,
        "target_r": 1.5,
        "directions": "both",
    }
    for bad in (
        {"range_minutes": 0},
        {"range_minutes": 241},
        {"range_minutes": 32},
        {"range_minutes": 30.0},
        {"min_range_atr": -0.1},
        {"target_r": 10.5},
        {"target_r": "1.5"},
        {"directions": "sideways"},
        {"stop": 3},
    ):
        with pytest.raises(ParameterError):
            orb.STRATEGY.validate(bad, "us_equity")


def test_unsupported_market_is_rejected():
    with pytest.raises(IncompatibleMarketError):
        orb.STRATEGY.spec(None, "forex")
