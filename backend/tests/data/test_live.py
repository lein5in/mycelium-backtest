import os

import pandas as pd
import pytest

from app.config import Settings
from app.data.errors import DataError
from app.data.heatmap import grid_from_trades
from app.data.registry import DataRegistry
from tests.data.pipeline import run_pipeline

pytestmark = pytest.mark.skipif(
    os.environ.get("MYCELIUM_LIVE") != "1",
    reason="live network smoke test; run with MYCELIUM_LIVE=1",
)


@pytest.fixture(scope="module")
def registry():
    built = DataRegistry(Settings(_env_file=None, enable_binance_archive=True))
    yield built
    built.close()


def now():
    return pd.Timestamp.now(tz="UTC")


def test_coinbase_smoke_and_end_to_end(registry):
    provider = registry.candles("coinbase")
    smoke = provider.fetch("BTC-USD", "5m", now() - pd.Timedelta(hours=6), now())
    print(f"\ncoinbase smoke: {smoke.bars.size} bars, last {smoke.bars.timestamp(-1)}")
    assert smoke.bars.size > 0
    data = provider.fetch("BTC-USD", "1h", now() - pd.Timedelta(days=60), now())
    outcome = run_pipeline(data, "donchian_breakout")
    print(f"coinbase e2e: {outcome.summary()}")


def test_kraken_smoke_and_end_to_end(registry):
    provider = registry.candles("kraken")
    smoke = provider.fetch("BTC-USD", "5m", now() - pd.Timedelta(hours=6), now())
    print(f"\nkraken smoke: {smoke.bars.size} bars, last {smoke.bars.timestamp(-1)}")
    assert smoke.bars.size > 0
    data = provider.fetch("ETH-USD", "1h", now() - pd.Timedelta(days=29), now())
    outcome = run_pipeline(data, "rsi_mean_reversion", {"trend_sma": 0})
    print(f"kraken e2e: {outcome.summary()}")


def test_kraken_trades_smoke_and_heatmap(registry):
    trades = registry.trades().fetch("BTC-USD", now() - pd.Timedelta(minutes=15), now())
    print(
        f"\nkraken trades smoke: {trades.time_ns.size} trades, truncated {trades.truncated}, "
        f"covered until {trades.covered_until}"
    )
    assert trades.time_ns.size > 0
    grid = grid_from_trades(trades.time_ns, trades.price, trades.volume, trades.buy).grid
    print(f"kraken trades e2e: heatmap {grid.columns}x{grid.rows} {grid.mode}")
    assert grid.mode == "FROM_TRADES"


def test_binance_archive_smoke_and_end_to_end(registry):
    provider = registry.candles("binance_archive")
    day = now().normalize() - pd.Timedelta(days=3)
    try:
        smoke = provider.fetch("BTC-USDT", "1h", day, day + pd.Timedelta(days=1))
    except DataError as error:
        pytest.skip(f"binance archive not reachable: {error.code}: {error.user_message}")
    print(f"\nbinance archive smoke: {smoke.bars.size} bars on {day.date()}")
    assert smoke.bars.size == 24
    start = now().normalize() - pd.Timedelta(days=33)
    data = provider.fetch("BTC-USDT", "1h", start, start + pd.Timedelta(days=30))
    outcome = run_pipeline(data, "donchian_breakout")
    print(f"binance archive e2e: {outcome.summary()}")
