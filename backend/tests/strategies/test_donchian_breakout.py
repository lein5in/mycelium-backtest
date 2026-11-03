import pytest

from app.strategies import donchian_breakout as donchian
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

BASE = [(100, 101, 99, 100)] * 25
STOP_DISTANCE = 2 * 28.7 / 14
LONG_TAIL = [
    (100, 102.5, 99.8, 102),
    (102.1, 103, 101.5, 102.5),
    (102.5, 103, 102, 102.8),
    (102.8, 103, 98.6, 98.8),
    (98.7, 99, 98.5, 98.8),
]
SHORT_TAIL = [
    (100, 100.2, 97.5, 98),
    (97.9, 98.5, 97, 97.5),
    (97.5, 98, 97, 97.2),
    (97.2, 101.4, 97.1, 101.2),
    (101.3, 101.5, 101, 101.2),
]


def spec(**values):
    return donchian.STRATEGY.spec(values, "crypto_24x7")


def series(tail, filler=((99, 100, 98, 99),) * 3):
    return crypto_bars(BASE + list(tail) + list(filler), "2024-01-01", timeframe="1h")


def test_long_breakout_of_a_channel_that_excludes_the_breakout_bar_exits_on_the_exit_channel():
    trades = run(spec(), series(LONG_TAIL), CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 26, 102.1, "exit_signal", pytest.approx(97 * (98.7 - 102.1) - 2))
    ]
    assert trades[0].signal_index == 25 and trades[0].exit_index == 29
    assert trades[0].stop_price == pytest.approx(102.1 - STOP_DISTANCE)


def test_short_breakout_exits_on_the_upper_exit_channel():
    trades = run(spec(), series(SHORT_TAIL, ((100, 101, 99, 100),) * 3), CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("short", 26, 97.9, "exit_signal", pytest.approx(102 * (97.9 - 101.3) - 2))
    ]


def test_no_breakout_no_trade():
    assert run(spec(), crypto_bars(BASE * 2, "2024-01-01", timeframe="1h"), CRYPTO).trades == []


def test_long_stopped_at_two_atr():
    tail = [LONG_TAIL[0], LONG_TAIL[1], (102.5, 103, 97.9, 98.5)]
    trades = run(spec(), series(tail), CRYPTO).trades
    assert [trade_tuple(t) for t in trades] == [
        ("long", 26, 102.1, "stop", pytest.approx(97 * -STOP_DISTANCE - 2))
    ]


def test_maximum_bars_held_exits_at_the_close():
    trade = run(spec(max_bars=2), series(LONG_TAIL), CRYPTO).trades[0]
    assert (trade.exit_index, trade.exit_reason) == (27, "time_exit")
    assert trade.net_pnl == pytest.approx(97 * (102.8 - 102.1) - 2)


def test_exit_channel_can_be_disabled():
    trade = run(
        spec(exit_lookback=0), series(LONG_TAIL, ((99, 100, 98.5, 99),) * 3), CRYPTO
    ).trades[0]
    assert trade.exit_reason == "end_of_data"


def test_no_trade_before_the_channel_warmup():
    rows = BASE[:15] + LONG_TAIL + BASE[:5]
    result = run(spec(), crypto_bars(rows, "2024-01-01", timeframe="1h"), CRYPTO)
    assert result.trades == [] and result.warmup_bars == 20


@pytest.mark.parametrize("k", [300, 900])
def test_no_look_ahead_on_crypto(k):
    bars = random_crypto(1_200, seed=14)
    assert len(assert_no_look_ahead(spec(), bars, CRYPTO, k)) >= 3


def test_no_look_ahead_on_us_equity():
    bars = random_us(15, seed=15, timeframe="30m")
    assert assert_no_look_ahead(donchian.STRATEGY.spec(None, "us_equity"), bars, US, 120)


def test_determinism():
    bars = random_crypto(1_000, seed=16)
    assert run(spec(), bars, CRYPTO).model_dump() == run(spec(), bars, CRYPTO).model_dump()


def test_defaults_are_valid_and_out_of_range_values_are_rejected():
    assert donchian.STRATEGY.validate(None, "crypto_24x7") == {
        "entry_lookback": 20,
        "stop_atr": 2.0,
        "exit_lookback": 10,
        "max_bars": 0,
        "directions": "both",
    }
    assert spec().time_exit.max_bars is None and spec().time_exit.session_end is False
    for bad in (
        {"entry_lookback": 1},
        {"entry_lookback": 501},
        {"entry_lookback": 20.5},
        {"stop_atr": 0.1},
        {"exit_lookback": -1},
        {"max_bars": 1_001},
    ):
        with pytest.raises(ParameterError):
            donchian.STRATEGY.validate(bad, "crypto_24x7")
