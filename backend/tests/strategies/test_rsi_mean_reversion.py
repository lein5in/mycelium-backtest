import pytest

from app.engine import indicators
from app.strategies import rsi_mean_reversion as rsi_mr
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

PREFIX = [quiet()] * 16
LONG_PATTERN = [
    (100, 101.3, 99.7, 101),
    (101, 102.3, 100.7, 102),
    (102, 102.3, 100.7, 101),
    (101, 101.3, 98.7, 99),
    (99, 99.3, 96.7, 97),
    (97, 98.8, 96.7, 98.5),
]
SHORT_PATTERN = [
    (100, 100.3, 98.7, 99),
    (99, 99.3, 97.7, 98),
    (98, 99.3, 97.7, 99),
    (99, 101.3, 98.7, 101),
    (101, 103.3, 100.7, 103),
    (103, 103.3, 101.2, 101.5),
]
ATR_AT_SIGNAL = 19.305996385435 / 14
HAND = {"rsi_period": 2, "trend_sma": 0}


def spec(market="crypto_24x7", **values):
    return rsi_mr.STRATEGY.spec({**HAND, **values}, market)


def series(pattern, *tail):
    return crypto_bars(PREFIX + pattern + list(tail) + [quiet()] * 2, "2024-01-01", "1h")


def test_rsi_2_path_100_100_42_86_13_04_5_45_49_51_68_86():
    bars = series(LONG_PATTERN, (98.6, 99.8, 98.4, 99.5))
    values = indicators.rsi(bars.close, 2)[16:23]
    assert values.tolist() == pytest.approx(
        [100, 100, 300 / 7, 300 / 23, 60 / 11, 5100 / 103, 11500 / 167]
    )


def test_long_on_the_cross_back_above_30_exits_when_rsi_reaches_50():
    bars = series(LONG_PATTERN, (98.6, 99.8, 98.4, 99.5), (99.6, 100, 99.4, 99.8))
    trades = run(spec(directions="long"), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 22, 98.6, "exit_signal", pytest.approx(101 * 1.0 - 2))
    ]
    assert trades[0].signal_index == 21
    assert trades[0].stop_price == pytest.approx(98.6 - 2 * ATR_AT_SIGNAL)


def test_short_on_the_cross_back_below_70_exits_when_rsi_reaches_50():
    bars = series(SHORT_PATTERN, (101.4, 101.6, 100.2, 100.5), (100.4, 100.6, 100, 100.2))
    trades = run(spec(directions="short"), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("short", 22, 101.4, "exit_signal", pytest.approx(98 * 1.0 - 2))
    ]


def test_flat_prices_do_not_trigger():
    assert run(spec(), crypto_bars([quiet()] * 60, "2024-01-01", "1h"), CRYPTO).trades == []


def test_long_stopped_at_two_atr():
    bars = series(LONG_PATTERN, (98.6, 98.8, 95.5, 96.0))
    trades = run(spec(directions="long"), bars, CRYPTO).trades
    assert [trade_tuple(t) for t in trades[:1]] == [
        ("long", 22, 98.6, "stop", pytest.approx(101 * -2 * ATR_AT_SIGNAL - 2))
    ]


def test_maximum_bars_held():
    bars = series(LONG_PATTERN, (98.6, 99.8, 98.4, 99.5), (99.6, 100, 99.4, 99.8))
    values = {"directions": "long", "exit_rsi": 94, "overbought": 95, "max_bars": 1}
    trade = run(spec(**values), bars, CRYPTO).trades[0]
    assert (trade.exit_index, trade.exit_reason) == (22, "time_exit")
    assert trade.net_pnl == pytest.approx(101 * 0.9 - 2)


def test_trend_filter_blocks_a_long_below_the_sma():
    bars = series(LONG_PATTERN, (98.6, 99.8, 98.4, 99.5), (99.6, 100, 99.4, 99.8))
    assert run(spec(directions="long", trend_sma=10), bars, CRYPTO).trades == []


def test_warmup_with_the_default_200_bar_trend_filter():
    bars = random_crypto(900, seed=17)
    result = run(rsi_mr.STRATEGY.spec(None, "crypto_24x7"), bars, CRYPTO)
    assert result.warmup_bars == 200
    assert result.trades and min(t.signal_index for t in result.trades) >= 200


def test_directions_default_depends_on_the_market():
    assert rsi_mr.STRATEGY.validate(None, "us_equity")["directions"] == "long"
    assert rsi_mr.STRATEGY.validate(None, "crypto_24x7")["directions"] == "both"
    assert rsi_mr.STRATEGY.spec(None, "us_equity").short is None
    assert rsi_mr.STRATEGY.spec({"directions": "both"}, "us_equity").short is not None


@pytest.mark.parametrize("k", [400, 1_000])
def test_no_look_ahead_on_crypto(k):
    bars = random_crypto(1_500, seed=18)
    trades = assert_no_look_ahead(rsi_mr.STRATEGY.spec(None, "crypto_24x7"), bars, CRYPTO, k)
    assert len(trades) >= 3


def test_no_look_ahead_on_us_equity():
    bars = random_us(30, seed=19, timeframe="15m")
    assert assert_no_look_ahead(rsi_mr.STRATEGY.spec(None, "us_equity"), bars, US, 500)


def test_determinism():
    bars = random_crypto(900, seed=20)
    built = rsi_mr.STRATEGY.spec(None, "crypto_24x7")
    assert run(built, bars, CRYPTO).model_dump() == run(built, bars, CRYPTO).model_dump()


def test_defaults_are_valid_and_invalid_values_are_rejected():
    assert rsi_mr.STRATEGY.validate(None, "crypto_24x7") == {
        "rsi_period": 14,
        "oversold": 30,
        "overbought": 70,
        "trend_sma": 200,
        "exit_rsi": 50,
        "stop_atr": 2.0,
        "max_bars": 10,
        "directions": "both",
    }
    for bad in (
        {"rsi_period": 1},
        {"rsi_period": 101},
        {"oversold": 51},
        {"overbought": 96},
        {"trend_sma": 501},
        {"max_bars": 0},
        {"exit_rsi": 30},
        {"oversold": 40, "exit_rsi": 35},
        {"rsi_period": None},
    ):
        with pytest.raises(ParameterError):
            rsi_mr.STRATEGY.validate(bad, "crypto_24x7")
