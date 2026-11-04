import threading
import time

import numpy as np
import pandas as pd
import pytest

from app.data.cache import CachedCandles, ChunkKey, DiskCache, chunk_starts, empty_arrays
from app.data.coinbase import CoinbaseCandles
from app.data.csv_import import import_csv
from app.data.kraken import KrakenCandles
from tests.data.fakes import NOW, coinbase_handler, fetcher, now

DAY = 86_400 * 10**9


def arrays(count: int, start_ns: int = 0):
    ts = start_ns + np.arange(count, dtype=np.int64) * 60 * 10**9
    price = 100.0 + np.arange(count, dtype=np.float64)
    return {
        "ts_ns": ts,
        "open": price,
        "high": price + 1,
        "low": price - 1,
        "close": price,
        "volume": np.ones(count),
    }


def make_cache(tmp_path, clock, max_bytes=10**9):
    return DiskCache(tmp_path / "cache", max_bytes, 30 * 86_400, 60, clock=lambda: clock[0])


def key(start_ns=0, timeframe="1m", symbol="BTC-USD"):
    return ChunkKey("coinbase", symbol, timeframe, start_ns)


def test_hit_and_miss(tmp_path):
    clock = [1_000.0]
    cache = make_cache(tmp_path, clock)
    calls = []

    def fetch():
        calls.append(1)
        return arrays(5)

    first, hit = cache.get_or_fetch(key(), NOW.value, fetch)
    second, hit_again = cache.get_or_fetch(key(), NOW.value, fetch)
    assert (hit, hit_again) == (False, True)
    assert calls == [1]
    np.testing.assert_array_equal(first["close"], second["close"])
    assert cache.stats.hits == 1 and cache.stats.misses == 1
    assert [p.suffix for p in (tmp_path / "cache").iterdir()] == [".npz"]


def test_closed_chunks_live_long_and_the_live_chunk_briefly(tmp_path):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    closed = key(0)
    live = key(NOW.value - NOW.value % DAY)
    for chunk in (closed, live):
        cache.get_or_fetch(chunk, NOW.value, lambda: arrays(3))
    clock[0] = 61.0
    assert cache.read(closed, NOW.value) is not None
    assert cache.read(live, NOW.value) is None
    clock[0] = 30 * 86_400 + 1.0
    assert cache.read(closed, NOW.value) is None


def test_least_recently_used_files_are_evicted(tmp_path):
    clock = [100.0]
    probe = make_cache(tmp_path, clock)
    probe.write(key(0), arrays(500))
    size = probe.size()
    cache = make_cache(tmp_path, clock, max_bytes=int(size * 3.5))
    for index in range(1, 3):
        clock[0] += 10
        cache.write(key(index * DAY), arrays(500))
    clock[0] += 10
    assert cache.read(key(0), NOW.value) is not None
    clock[0] += 10
    cache.write(key(3 * DAY), arrays(500))
    names = sorted(p.name for p in (tmp_path / "cache").glob("*.npz"))
    assert cache.stats.evicted == 1
    assert key(1 * DAY).filename not in names
    assert key(0).filename in names


@pytest.mark.parametrize(
    "damage",
    [
        lambda path: path.write_bytes(b"not a zip"),
        lambda path: path.write_bytes(path.read_bytes()[:40]),
        lambda path: np.savez(path, ts_ns=np.arange(3), written_at=np.float64(0)),
        lambda path: np.savez(path, written_at=np.float64(0), **{**arrays(3), "close": np.ones(4)}),
    ],
)
def test_corrupted_files_are_discarded_and_refetched(tmp_path, damage):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    cache.write(key(), arrays(3))
    path = cache.path(key())
    damage(path)
    if path.suffix != ".npz":
        path.rename(path.with_suffix(".npz"))
    calls = []
    result, hit = cache.get_or_fetch(key(), NOW.value, lambda: calls.append(1) or arrays(4))
    assert not hit
    assert calls == [1]
    assert result["close"].size == 4
    assert cache.stats.discarded == 1


def test_pickled_objects_are_never_loaded(tmp_path):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    cache.directory.mkdir(parents=True)
    hostile = {name: np.array([object()], dtype=object) for name in ("ts_ns", "open")}
    np.savez(cache.path(key()), allow_pickle=True, **hostile)
    assert cache.read(key(), NOW.value) is None
    assert cache.stats.discarded == 1


def test_concurrent_requests_for_one_chunk_fetch_once(tmp_path):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    calls = []
    gate = threading.Event()

    def fetch():
        calls.append(1)
        gate.wait(1)
        return arrays(5)

    results = []

    def worker():
        results.append(cache.get_or_fetch(key(), NOW.value, fetch)[1])

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    time.sleep(0.05)
    gate.set()
    for thread in threads:
        thread.join()
    assert calls == [1]
    assert sorted(results) == [False] + [True] * 7


def test_keys_refuse_uncached_sources_and_odd_parts():
    for provider in ("user_csv", "samples", "yahoo", "kraken"):
        with pytest.raises(ValueError, match="never cached"):
            ChunkKey(provider, "BTC-USD", "1m", 0)
    with pytest.raises(ValueError):
        ChunkKey("coinbase", "../../etc", "1m", 0)


def test_cached_candles_split_by_chunk_and_reuse_them(tmp_path):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    built, recorder = fetcher(coinbase_handler(), "coinbase")
    source = CachedCandles(CoinbaseCandles(built, now), cache)
    start = pd.Timestamp("2026-10-30 12:00", tz="UTC")
    end = pd.Timestamp("2026-11-01 06:00", tz="UTC")
    first = source.fetch("BTC-USD", "1h", start, end)
    calls = len(recorder.requests)
    second = source.fetch("BTC-USD", "1h", start, end)
    assert len(recorder.requests) == calls
    assert first.bars.size == second.bars.size == 42
    np.testing.assert_array_equal(first.bars.close, second.bars.close)
    assert len(chunk_starts("1h", start.value, end.value)) == 1
    assert first.source.provider == "coinbase"


def test_kraken_is_not_cached(tmp_path):
    clock = [0.0]
    built, _ = fetcher(coinbase_handler(), "kraken")
    with pytest.raises(ValueError):
        CachedCandles(KrakenCandles(built, now), make_cache(tmp_path, clock))


def test_csv_uploads_never_reach_the_cache(tmp_path):
    clock = [0.0]
    cache = make_cache(tmp_path, clock)
    cache.directory.mkdir(parents=True)
    content = "timestamp,open,high,low,close,volume\n" + "".join(
        f"2024-01-01T00:{m:02d}:00Z,1,2,0.5,1.5,3\n" for m in range(30)
    )
    result, _ = import_csv(content.encode())
    assert result.bars.size == 30
    assert list(cache.directory.iterdir()) == []
    assert empty_arrays()["ts_ns"].dtype == np.int64
