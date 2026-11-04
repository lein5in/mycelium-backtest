import types

import httpx2
import numpy as np
import pandas as pd
import pytest

from app.config import Settings
from app.data import samples, yahoo
from app.data.errors import (
    InvalidSymbolError,
    OutOfRangeError,
    ProviderDisabledError,
    UnsupportedError,
)
from app.data.registry import DataRegistry
from app.engine import BacktestConfig, run_backtest
from app.engine.sessions import UsEquitySession, map_sessions
from app.strategies.registry import build_spec
from tests.data.fakes import NOW, coinbase_handler, now

UTC = "UTC"


def stamp(text):
    return pd.Timestamp(text, tz=UTC)


def test_samples_are_deterministic_and_consistent_across_ranges():
    full = samples.fetch_sample("SAMPLE-A", "5m", stamp("2024-11-01"), stamp("2024-12-31"))
    again = samples.fetch_sample("SAMPLE-A", "5m", stamp("2024-11-01"), stamp("2024-12-31"))
    part = samples.fetch_sample("SAMPLE-A", "5m", stamp("2024-12-02"), stamp("2024-12-10"))
    np.testing.assert_array_equal(full.bars.close, again.bars.close)
    offset = int(np.searchsorted(full.bars.ts_ns, part.bars.ts_ns[0]))
    np.testing.assert_array_equal(
        full.bars.close[offset : offset + part.bars.size], part.bars.close
    )
    assert full.source.mode == "SAMPLE DATA"
    assert "Not real market data" in full.source.attribution
    assert full.source.market == "us_equity"


def test_samples_follow_the_nyse_calendar():
    result = samples.fetch_sample("SAMPLE-B", "1m", stamp("2024-11-25"), stamp("2024-12-03"))
    bars = result.bars
    sessions = map_sessions(UsEquitySession(), bars.ts_ns, bars.interval_minutes)
    assert not sessions.outside.any()
    days = pd.DatetimeIndex(bars.ts_ns.astype("datetime64[ns]")).tz_localize(UTC)
    per_day = pd.Series(1, index=days.tz_convert("America/New_York").date).groupby(level=0).sum()
    counts = {day.isoformat(): int(count) for day, count in per_day.items()}
    assert "2024-11-28" not in counts
    assert counts["2024-11-29"] == 210
    assert counts["2024-11-27"] == 390
    assert result.gaps.missing_bars == 0


def test_five_minute_samples_aggregate_the_minute_path():
    one = samples.fetch_sample("SAMPLE-A", "1m", stamp("2024-12-02"), stamp("2024-12-03")).bars
    five = samples.fetch_sample("SAMPLE-A", "5m", stamp("2024-12-02"), stamp("2024-12-03")).bars
    assert five.size == 78
    assert five.open[0] == one.open[0]
    assert five.close[0] == one.close[4]
    assert five.high[0] == one.high[:5].max()
    assert five.volume.sum() == pytest.approx(one.volume.sum())


def test_samples_have_a_u_shaped_volume_profile_and_overnight_gaps():
    bars = samples.fetch_sample("SAMPLE-B", "5m", stamp("2024-01-02"), stamp("2024-07-01")).bars
    sessions = map_sessions(UsEquitySession(), bars.ts_ns, bars.interval_minutes)
    minutes = sessions.minutes_since_open
    edges = bars.volume[(minutes < 30) | (minutes >= 360)].mean()
    middle = bars.volume[(minutes >= 150) & (minutes < 240)].mean()
    assert edges > 1.5 * middle
    first = np.flatnonzero(sessions.first_in_session)
    gaps = bars.open[first[1:]] / bars.close[first[1:] - 1] - 1
    assert (np.abs(gaps) >= 0.005).sum() >= 10
    spec = build_spec("gap_fade", {}, "us_equity")
    trades = run_backtest(bars, spec, BacktestConfig(session=UsEquitySession())).result.trades
    assert trades


def test_sample_bounds():
    with pytest.raises(InvalidSymbolError):
        samples.fetch_sample("AAPL", "5m", stamp("2024-01-02"), stamp("2024-02-01"))
    with pytest.raises(OutOfRangeError, match="90 days"):
        samples.fetch_sample("SAMPLE-A", "1m", stamp("2024-01-02"), stamp("2024-06-01"))
    with pytest.raises(OutOfRangeError, match="start on"):
        samples.fetch_sample("SAMPLE-A", "5m", stamp("2019-06-01"), stamp("2019-08-01"))
    with pytest.raises(UnsupportedError):
        samples.fetch_sample("SAMPLE-A", "1h", stamp("2024-01-02"), stamp("2024-02-01"))


def settings(**values):
    return Settings(_env_file=None, **values)


def test_yahoo_is_not_registered_when_the_flag_is_off():
    registry = DataRegistry(settings())
    with pytest.raises(ProviderDisabledError, match="personal use"):
        registry.candles("yahoo")
    listed = {info.id: info for info in registry.providers()}
    assert listed["yahoo"].enabled is False
    assert listed["yahoo"].mode == "PERSONAL USE ONLY"
    assert listed["binance_archive"].enabled is False
    with pytest.raises(ProviderDisabledError):
        registry.candles("binance_archive")
    with pytest.raises(UnsupportedError):
        registry.candles("api.binance.com")


def fake_yfinance(frame):
    calls = []

    def download(**kwargs):
        calls.append(kwargs)
        return frame

    return types.SimpleNamespace(download=download), calls


def yahoo_frame():
    index = pd.date_range("2026-10-28 09:30", periods=6, freq="5min", tz="America/New_York")
    data = {
        "Open": [10.0, 10.1, 10.2, 10.1, 10.0, 10.2],
        "High": [10.2, 10.3, 10.3, 10.2, 10.3, 10.4],
        "Low": [9.9, 10.0, 10.0, 9.9, 9.9, 10.1],
        "Close": [10.1, 10.2, 10.1, 10.0, 10.2, 10.3],
        "Adj Close": [10.1, 10.2, 10.1, 10.0, 10.2, 10.3],
        "Volume": [100, 120, 90, 80, 110, 130],
    }
    return pd.DataFrame(data, index=index)


def test_yahoo_adapter_when_enabled_converts_to_utc_and_labels_personal_use():
    module, calls = fake_yfinance(yahoo_frame())
    registry = DataRegistry(settings(enable_yahoo=True), now=now, yahoo_loader=lambda: module)
    provider = registry.candles("yahoo")
    result = provider.fetch("SPY", "5m", stamp("2026-10-28"), stamp("2026-10-29"))
    assert calls[0]["interval"] == "5m"
    assert calls[0]["prepost"] is False
    assert result.bars.size == 6
    assert result.bars.timestamp(0) == stamp("2026-10-28 13:30")
    assert result.source.mode == "PERSONAL USE ONLY"
    assert "not available in the hosted version" in result.source.attribution
    assert {info.id: info for info in registry.providers()}["yahoo"].enabled


def test_yahoo_history_limits_are_range_errors():
    module, calls = fake_yfinance(yahoo_frame())
    provider = yahoo.YahooCandles(lambda: module, now)
    with pytest.raises(OutOfRangeError, match="7 days"):
        provider.fetch("SPY", "1m", NOW - pd.Timedelta(days=8), NOW)
    with pytest.raises(OutOfRangeError, match="history"):
        provider.fetch("SPY", "1m", NOW - pd.Timedelta(days=40), NOW - pd.Timedelta(days=36))
    with pytest.raises(InvalidSymbolError):
        provider.fetch("spy;rm", "1d", NOW - pd.Timedelta(days=8), NOW)
    assert calls == []


def test_yahoo_without_the_library_is_an_explicit_error(monkeypatch):
    def missing(name):
        raise ImportError(name)

    monkeypatch.setattr(yahoo.importlib, "import_module", missing)
    with pytest.raises(UnsupportedError, match="not installed"):
        yahoo.load_yfinance()


def test_registry_lists_markets_timeframes_and_limits():
    listed = {info.id: info for info in DataRegistry(settings()).providers()}
    assert set(listed) == {
        "coinbase",
        "kraken",
        "kraken_trades",
        "binance_archive",
        "samples",
        "user_csv",
        "yahoo",
    }
    assert listed["coinbase"].markets == ["crypto_24x7"]
    assert listed["coinbase"].timeframes == ["1m", "5m", "15m", "1h", "1d"]
    assert listed["coinbase"].max_range_days["1m"] == 30
    assert listed["kraken"].history_days["1m"] < 1
    assert listed["samples"].markets == ["us_equity"]
    assert listed["samples"].mode == "SAMPLE DATA"
    assert all(info.attribution for info in listed.values())


def test_registry_builds_working_providers_with_its_own_client():
    def factory():
        return httpx2.Client(transport=httpx2.MockTransport(coinbase_handler()))

    registry = DataRegistry(settings(), client_factory=factory, now=now)
    provider = registry.candles("coinbase")
    provider.fetcher.limiter.min_interval = 0.0
    result = provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=3), NOW)
    assert result.bars.size == 3
    registry.close()
