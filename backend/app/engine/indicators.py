import numpy as np
import pandas as pd


def _check_period(period: int) -> None:
    if not isinstance(period, int) or isinstance(period, bool) or period < 1:
        raise ValueError(f"period must be a positive integer, got {period!r}")


def _float(values: np.ndarray) -> np.ndarray:
    return np.asarray(values, dtype=np.float64)


def _first_valid(values: np.ndarray) -> int:
    valid = np.flatnonzero(~np.isnan(values))
    return int(valid[0]) if valid.size else values.size


def _recursive(values: np.ndarray, period: int, alpha: float) -> np.ndarray:
    out = np.full(values.size, np.nan)
    start = _first_valid(values)
    seed_end = start + period
    if seed_end > values.size or np.isnan(values[start:seed_end]).any():
        return out
    level = float(values[start:seed_end].mean())
    out[seed_end - 1] = level
    source = values.tolist()
    result = out.tolist()
    keep = 1.0 - alpha
    for i in range(seed_end, values.size):
        value = source[i]
        if value != value:
            break
        level = keep * level + alpha * value
        result[i] = level
    return np.asarray(result, dtype=np.float64)


def sma(values: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    return pd.Series(_float(values)).rolling(period, min_periods=period).mean().to_numpy()


def rolling_std(values: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    series = pd.Series(_float(values))
    return series.rolling(period, min_periods=period).std(ddof=0).to_numpy()


def ema(values: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    return _recursive(_float(values), period, 2.0 / (period + 1))


def wilder(values: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    return _recursive(_float(values), period, 1.0 / period)


def rsi(close: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    close = _float(close)
    change = np.full(close.size, np.nan)
    change[1:] = np.diff(close)
    gain = np.where(np.isnan(change), np.nan, np.maximum(change, 0.0))
    loss = np.where(np.isnan(change), np.nan, np.maximum(-change, 0.0))
    average_gain = wilder(gain, period)
    average_loss = wilder(loss, period)
    with np.errstate(divide="ignore", invalid="ignore"):
        value = 100.0 - 100.0 / (1.0 + average_gain / average_loss)
    value = np.where(average_loss == 0.0, np.where(average_gain == 0.0, 50.0, 100.0), value)
    return np.where(np.isnan(average_gain) | np.isnan(average_loss), np.nan, value)


def true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    high, low, close = _float(high), _float(low), _float(close)
    out = np.full(close.size, np.nan)
    if close.size > 1:
        previous = close[:-1]
        out[1:] = np.maximum.reduce(
            [high[1:] - low[1:], np.abs(high[1:] - previous), np.abs(low[1:] - previous)]
        )
    return out


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    return wilder(true_range(high, low, close), period)


def directional_movement(high: np.ndarray, low: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    high, low = _float(high), _float(low)
    plus = np.full(high.size, np.nan)
    minus = np.full(high.size, np.nan)
    if high.size > 1:
        up = high[1:] - high[:-1]
        down = low[:-1] - low[1:]
        plus[1:] = np.where((up > down) & (up > 0), up, 0.0)
        minus[1:] = np.where((down > up) & (down > 0), down, 0.0)
    return plus, minus


def adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    _check_period(period)
    return wilder(directional_index(high, low, close, period), period)


def directional_index(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int
) -> np.ndarray:
    _check_period(period)
    plus_dm, minus_dm = directional_movement(high, low)
    smoothed_tr = wilder(true_range(high, low, close), period)
    smoothed_plus = wilder(plus_dm, period)
    smoothed_minus = wilder(minus_dm, period)
    with np.errstate(divide="ignore", invalid="ignore"):
        plus_di = 100.0 * smoothed_plus / smoothed_tr
        minus_di = 100.0 * smoothed_minus / smoothed_tr
        total = plus_di + minus_di
        dx = 100.0 * np.abs(plus_di - minus_di) / total
    dx = np.where(total == 0.0, 0.0, dx)
    return np.where(np.isnan(smoothed_tr), np.nan, dx)


def session_vwap(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    session_ordinal: np.ndarray,
) -> np.ndarray:
    typical = (_float(high) + _float(low) + _float(close)) / 3.0
    volume = _float(volume)
    frame = pd.DataFrame({"pv": typical * volume, "v": volume, "s": session_ordinal})
    grouped = frame.groupby("s", sort=False)
    cumulative_pv = grouped["pv"].cumsum().to_numpy()
    cumulative_v = grouped["v"].cumsum().to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        value = cumulative_pv / cumulative_v
    return np.where(cumulative_v > 0.0, value, np.nan)


def donchian(high: np.ndarray, low: np.ndarray, period: int) -> tuple[np.ndarray, np.ndarray]:
    _check_period(period)
    upper = pd.Series(_float(high)).rolling(period, min_periods=period).max().shift(1)
    lower = pd.Series(_float(low)).rolling(period, min_periods=period).min().shift(1)
    return upper.to_numpy(), lower.to_numpy()


WARMUP = {
    "sma": lambda period: period - 1,
    "ema": lambda period: period - 1,
    "rolling_std": lambda period: period - 1,
    "rsi": lambda period: period,
    "atr": lambda period: period,
    "adx": lambda period: 2 * period - 1,
    "donchian": lambda period: period,
}
