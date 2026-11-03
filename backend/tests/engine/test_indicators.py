import numpy as np
import pytest

from app.engine import indicators

NAN = np.nan


def assert_series(actual, expected):
    np.testing.assert_allclose(actual, np.array(expected, dtype=float), rtol=0, atol=1e-9)


def random_walk(size=600, seed=7):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 1, size))
    spread = rng.uniform(0.1, 1.5, size)
    return close + spread, close - spread, close


def test_sma_1_to_5_period_3_is_2_3_4():
    assert_series(indicators.sma(np.array([1, 2, 3, 4, 5.0]), 3), [NAN, NAN, 2, 3, 4])


def test_ema_period_3_seeded_with_sma_4_then_6_then_5():
    assert_series(indicators.ema(np.array([2, 4, 6, 8, 4.0]), 3), [NAN, NAN, 4, 6, 5])


def test_population_std_textbook_2_4_4_4_5_5_7_9_is_2():
    values = np.array([2, 4, 4, 4, 5, 5, 7, 9.0])
    assert indicators.rolling_std(values, 8)[-1] == pytest.approx(2.0)
    assert np.isnan(indicators.rolling_std(values, 8)[:7]).all()


def test_rsi_period_3_hand_computed_66_67_83_33_60_61():
    close = np.array([10, 11, 12, 11, 13, 12.0])
    assert_series(
        indicators.rsi(close, 3),
        [NAN, NAN, NAN, 100 - 100 / 3, 100 - 100 / 6, 100 - 1300 / 33],
    )


def test_rsi_extremes_all_gains_100_flat_50():
    assert indicators.rsi(np.arange(1.0, 10.0), 3)[-1] == 100.0
    assert indicators.rsi(np.full(10, 5.0), 3)[-1] == 50.0


def test_true_range_uses_previous_close_and_starts_after_first_bar():
    high = np.array([10, 11, 13, 12, 15, 14.0])
    low = np.array([8, 9, 10, 9, 11, 13.0])
    close = np.array([9, 10, 12, 10, 14, 13.5])
    assert_series(indicators.true_range(high, low, close), [NAN, 2, 3, 3, 5, 1])


def test_atr_period_3_wilder_8_over_3_then_31_over_9_then_71_over_27():
    high = np.array([10, 11, 13, 12, 15, 14.0])
    low = np.array([8, 9, 10, 9, 11, 13.0])
    close = np.array([9, 10, 12, 10, 14, 13.5])
    assert_series(indicators.atr(high, low, close, 3), [NAN, NAN, NAN, 8 / 3, 31 / 9, 71 / 27])


ADX_HIGH = np.array([10, 11, 11.5, 11, 10.5, 12])
ADX_LOW = np.array([9, 9.5, 10, 9, 8.5, 10])
ADX_CLOSE = np.array([9.5, 10.5, 11, 9.5, 10, 11.5])


def test_directional_index_period_2_is_100_then_100_over_7_then_500_over_11_then_1900_over_35():
    assert_series(
        indicators.directional_index(ADX_HIGH, ADX_LOW, ADX_CLOSE, 2),
        [NAN, NAN, 100, 100 / 7, 500 / 11, 1900 / 35],
    )


def test_adx_period_2_first_value_is_mean_of_two_dx_400_over_7():
    first = 400 / 7
    second = (first + 500 / 11) / 2
    third = (second + 1900 / 35) / 2
    assert_series(
        indicators.adx(ADX_HIGH, ADX_LOW, ADX_CLOSE, 2), [NAN, NAN, NAN, first, second, third]
    )


@pytest.mark.parametrize("period", [5, 14, 30])
def test_rsi_and_adx_are_nan_during_warmup_and_finite_after(period):
    high, low, close = random_walk()
    rsi = indicators.rsi(close, period)
    adx = indicators.adx(high, low, close, period)
    assert np.isnan(rsi[:period]).all() and np.isfinite(rsi[period:]).all()
    assert np.isnan(adx[: 2 * period - 1]).all() and np.isfinite(adx[2 * period - 1 :]).all()
    assert indicators.WARMUP["rsi"](period) == period
    assert indicators.WARMUP["adx"](period) == 2 * period - 1


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_adx_has_no_start_up_artefact_on_a_random_walk(seed):
    period = 14
    high, low, close = random_walk(seed=seed)
    dx = indicators.directional_index(high, low, close, period)
    adx = indicators.adx(high, low, close, period)
    start = 2 * period - 1
    assert adx[start] == pytest.approx(dx[period : start + 1].mean())
    for t in range(start, close.size):
        window = dx[period : t + 1]
        assert window.min() - 1e-9 <= adx[t] <= window.max() + 1e-9


def test_atr_and_ema_never_report_zero_or_partial_values_in_warmup():
    high, low, close = random_walk(size=40)
    atr = indicators.atr(high, low, close, 14)
    ema = indicators.ema(close, 10)
    assert np.isnan(atr[:14]).all() and np.isfinite(atr[14:]).all()
    assert np.isnan(ema[:9]).all() and np.isfinite(ema[9:]).all()


def test_session_vwap_resets_per_session_and_handles_zero_volume():
    high = np.array([11, 12, 21, 31, 34.0])
    low = np.array([9, 10, 19, 29, 32.0])
    close = np.array([10, 11, 20, 30, 33.0])
    volume = np.array([100, 300, 0, 0, 10.0])
    session = np.array([0, 0, 0, 1, 1])
    assert_series(
        indicators.session_vwap(high, low, close, volume, session), [10, 10.75, 10.75, NAN, 33]
    )


def test_donchian_period_3_uses_previous_bars_only():
    high = np.array([1, 5, 3, 2, 4, 6.0])
    low = np.array([0.5, 4, 2, 1, 3, 5.0])
    upper, lower = indicators.donchian(high, low, 3)
    assert_series(upper, [NAN, NAN, NAN, 5, 5, 4])
    assert_series(lower, [NAN, NAN, NAN, 0.5, 1, 1])


def test_donchian_never_uses_the_current_bar():
    high, low, _ = random_walk(size=200)
    upper, lower = indicators.donchian(high, low, 20)
    for i in range(20, 200):
        assert upper[i] == high[i - 20 : i].max()
        assert lower[i] == low[i - 20 : i].min()
        spiked_high = high.copy()
        spiked_low = low.copy()
        spiked_high[i] = 1e6
        spiked_low[i] = -1e6
        assert indicators.donchian(spiked_high, spiked_low, 20)[0][i] == upper[i]
        assert indicators.donchian(spiked_high, spiked_low, 20)[1][i] == lower[i]


@pytest.mark.parametrize("period", [0, -3, 2.5, True])
def test_invalid_periods_are_rejected(period):
    with pytest.raises(ValueError, match="positive integer"):
        indicators.sma(np.arange(10.0), period)


def test_series_shorter_than_the_period_is_all_nan():
    assert np.isnan(indicators.rsi(np.arange(1.0, 5.0), 14)).all()
    assert np.isnan(indicators.ema(np.arange(1.0, 5.0), 14)).all()
