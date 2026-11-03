import pytest

from app.strategies import vwap_mean_reversion as vwap
from app.strategies.params import ParameterError
from tests.strategies.helpers import (
    CRYPTO,
    US,
    assert_no_look_ahead,
    crypto_bars,
    random_crypto,
    random_us,
    run,
    trade_tuple,
)

ATR_AT_SIGNAL = 16 / 14
STOP_DISTANCE = 1.5 * ATR_AT_SIGNAL


def oscillating(count: int):
    return [(100, 100.5, 99.5, 100.25 if i % 2 == 0 else 99.75) for i in range(count)]


def spec(**values):
    return vwap.STRATEGY.spec(values, "crypto_24x7")


def series(*tail, start="2024-01-02 00:00"):
    return crypto_bars(oscillating(40) + list(tail) + oscillating(4), start)


def test_long_below_the_band_exits_at_the_vwap_on_a_gap():
    bars = series((100, 100, 97, 97.5), (97.6, 98, 97.4, 97.8), (100.5, 100.8, 100.3, 100.6))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 41, 97.6, "target", pytest.approx(102 * 2.9 - 2))
    ]
    assert trades[0].exit_fill == "open"
    assert trades[0].stop_price == pytest.approx(97.6 - STOP_DISTANCE)


def test_short_above_the_band_exits_at_the_vwap():
    bars = series((100, 103, 100, 102.5), (102.4, 102.6, 102.2, 102.2), (99.5, 99.7, 99.2, 99.4))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("short", 41, 102.4, "target", pytest.approx(97 * 2.9 - 2))
    ]


def test_no_stretch_no_trade():
    assert run(spec(), crypto_bars(oscillating(60), "2024-01-02 00:00"), CRYPTO).trades == []


def test_long_stopped_at_1_5_atr():
    bars = series((100, 100, 97, 97.5), (97.6, 98, 95.8, 96), (96, 96.5, 95.9, 96.2))
    trades = run(spec(), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 41, 97.6, "stop", pytest.approx(-102 * STOP_DISTANCE - 2))
    ]


def test_first_minutes_of_the_session_are_skipped():
    rows = [*oscillating(38), (100, 100, 97, 97.5), (97.6, 98, 97.4, 97.8), *oscillating(4)]
    bars = crypto_bars(rows, "2024-01-01 21:00")
    assert run(spec(), bars, CRYPTO).trades == []
    assert len(run(spec(skip_minutes=0), bars, CRYPTO).trades) == 1


def test_no_trade_before_the_deviation_window_is_ready():
    rows = [*oscillating(20), (100, 100, 97, 97.5), (97.6, 98, 97.4, 97.8), *oscillating(4)]
    result = run(spec(), crypto_bars(rows, "2024-01-02 00:00"), CRYPTO)
    assert result.trades == [] and result.warmup_bars == 29


@pytest.mark.parametrize("k", [500, 1_200])
def test_no_look_ahead_on_us_equity(k):
    bars = random_us(25, seed=8)
    assert len(assert_no_look_ahead(spec(), bars, US, k)) >= 3


def test_no_look_ahead_on_crypto():
    bars = random_crypto(3_000, seed=9, timeframe="5m")
    assert assert_no_look_ahead(spec(), bars, CRYPTO, 2_000)


def test_determinism():
    bars = random_us(20, seed=10)
    assert run(spec(), bars, US).model_dump() == run(spec(), bars, US).model_dump()


def test_defaults_are_valid_and_out_of_range_values_are_rejected():
    assert vwap.STRATEGY.validate({}, "crypto_24x7") == {
        "threshold_std": 2.0,
        "stop_atr": 1.5,
        "skip_minutes": 30,
        "std_window": 30,
        "directions": "both",
    }
    for bad in (
        {"threshold_std": 0.4},
        {"threshold_std": 5.1},
        {"threshold_std": 2.05},
        {"stop_atr": 0},
        {"skip_minutes": 7},
        {"std_window": 4},
        {"std_window": 501},
        {"std_window": True},
    ):
        with pytest.raises(ParameterError):
            vwap.STRATEGY.validate(bad, "crypto_24x7")
