import pytest

from app.engine import IncompatibleMarketError, run_backtest
from app.strategies import gap_fade
from app.strategies.params import ParameterError
from tests.strategies.helpers import (
    CRYPTO,
    US,
    assert_no_look_ahead,
    quiet,
    random_crypto,
    random_us,
    run,
    trade_tuple,
    us_session_bars,
)

FULL_DAY = [quiet()] * 13
GAP_DOWN = (99, 99.4, 98.6, 99.2)
GAP_UP = (101, 101.4, 100.6, 100.8)


def spec(**values):
    return gap_fade.STRATEGY.spec(values, "us_equity")


def early_close_day(*bars):
    rows = list(bars) + [quiet()] * (7 - len(bars))
    return us_session_bars({"2024-12-23": FULL_DAY, "2024-12-24": rows})


def test_gap_down_is_faded_to_the_previous_close_on_the_early_close_day():
    trades = run(spec(), early_close_day(GAP_DOWN, (99.3, 100.2, 99.2, 100)), US).trades
    assert [trade_tuple(t) for t in trades] == [("long", 14, 99.3, "target", pytest.approx(68))]
    assert trades[0].signal_index == 13
    assert trades[0].stop_price == pytest.approx(98.1)
    assert trades[0].target_price == 100


def test_gap_up_is_faded_short():
    trades = run(spec(), early_close_day(GAP_UP, (100.7, 100.8, 99.9, 100)), US).trades
    assert [trade_tuple(t) for t in trades] == [("short", 14, 100.7, "target", pytest.approx(67.3))]
    assert trades[0].stop_price == pytest.approx(101.9)


@pytest.mark.parametrize(
    "first_bar",
    [
        (99.7, 99.9, 99.5, 99.8),
        (94, 94.5, 93.5, 94.2),
        (99, 100.3, 98.8, 100.1),
    ],
    ids=["gap_too_small", "gap_too_large", "gap_already_closed"],
)
def test_gaps_that_must_not_trigger(first_bar):
    assert run(spec(), early_close_day(first_bar, (99.3, 100.2, 99.2, 100)), US).trades == []


def test_stop_beyond_the_first_bar_low():
    trades = run(spec(), early_close_day(GAP_DOWN, (99.3, 99.5, 98.0, 98.2)), US).trades
    assert [trade_tuple(t) for t in trades] == [("long", 14, 99.3, "stop", pytest.approx(-122))]


def test_time_exit_at_the_13_00_early_close():
    rows = [GAP_DOWN] + [(99.3, 99.8, 98.9, 99.5)] * 6
    trade = run(spec(), early_close_day(*rows), US).trades[0]
    assert (trade.exit_index, trade.exit_reason) == (19, "time_exit")
    assert trade.exit_time.isoformat() == "2024-12-24T17:30:00+00:00"
    assert trade.net_pnl == pytest.approx(100 * 0.2 - 2)


def test_gap_after_an_early_close_uses_the_13_00_close():
    bars = us_session_bars(
        {"2024-12-24": [quiet()] * 7, "2024-12-26": [GAP_DOWN, (99.3, 100.2, 99.2, 100)]}
    )
    trades = run(spec(), bars, US).trades
    assert [trade_tuple(t) for t in trades] == [("long", 8, 99.3, "target", pytest.approx(68))]


def test_gap_after_the_2021_12_24_closure_uses_the_23rd_close():
    bars = us_session_bars(
        {"2021-12-23": FULL_DAY, "2021-12-27": [GAP_UP, (100.7, 100.8, 99.9, 100)]}
    )
    trades = run(spec(), bars, US).trades
    assert [trade_tuple(t) for t in trades] == [("short", 14, 100.7, "target", pytest.approx(67.3))]


def test_first_session_and_missing_previous_session_do_not_trade():
    only_one = us_session_bars({"2024-12-24": [GAP_DOWN, (99.3, 100.2, 99.2, 100)]})
    assert run(spec(), only_one, US).trades == []
    missing = us_session_bars(
        {"2024-12-23": FULL_DAY, "2024-12-26": [GAP_DOWN, (99.3, 100.2, 99.2, 100)]}
    )
    assert run(spec(), missing, US).trades == []


def test_crypto_is_rejected_with_an_explicit_message():
    with pytest.raises(IncompatibleMarketError, match="crypto trades 24/7"):
        gap_fade.STRATEGY.spec(None, "crypto_24x7")
    with pytest.raises(IncompatibleMarketError, match="does not support crypto_24x7"):
        run_backtest(random_crypto(100, 1), spec(), CRYPTO)


@pytest.mark.parametrize("k", [700, 1_400])
def test_no_look_ahead(k):
    bars = random_us(25, seed=12)
    assert len(assert_no_look_ahead(spec(), bars, US, k)) >= 3


def test_determinism_and_no_warmup_needed():
    bars = random_us(20, seed=13)
    first = run(spec(), bars, US)
    assert first.model_dump() == run(spec(), bars, US).model_dump()
    assert first.warmup_bars == 0
    assert all(t.signal_index == t.entry_index - 1 for t in first.trades)


def test_defaults_are_valid_and_invalid_values_are_rejected():
    assert gap_fade.STRATEGY.validate(None, "us_equity") == {
        "min_gap_pct": 0.5,
        "max_gap_pct": 5.0,
        "stop_gap_fraction": 0.5,
        "directions": "both",
    }
    for bad in (
        {"min_gap_pct": 0},
        {"max_gap_pct": 25},
        {"stop_gap_fraction": 0.05},
        {"min_gap_pct": 5.0, "max_gap_pct": 5.0},
        {"min_gap_pct": 6.0},
    ):
        with pytest.raises(ParameterError):
            gap_fade.STRATEGY.validate(bad, "us_equity")
