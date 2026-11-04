import threading

import httpx2
import numpy as np
import pandas as pd
import pytest

from app.data.binance_archive import BinanceArchive, archive_files
from app.data.catalog import Window
from app.data.coinbase import CoinbaseCandles
from app.data.errors import (
    BadPayloadError,
    BusyError,
    InvalidSymbolError,
    NetworkError,
    NotFoundError,
    OutOfRangeError,
    RateLimitedError,
    UnsupportedError,
)
from app.data.http import FetchBudget, RateLimiter, fetch_slot
from app.data.kraken import KrakenCandles, KrakenTrades
from tests.data.fakes import (
    NOW,
    coinbase_handler,
    fetcher,
    kline_zip,
    kraken_ohlc,
    now,
    synthetic_candle,
)


def coinbase(handler, sleeps=None):
    built, recorder = fetcher(handler, "coinbase", sleeps)
    return CoinbaseCandles(built, now), recorder


def never(request):
    raise AssertionError(f"no request expected, got {request.url}")


def test_coinbase_pages_by_300_and_maps_columns():
    provider, recorder = coinbase(coinbase_handler())
    start = pd.Timestamp("2026-11-01 00:00", tz="UTC")
    result = provider.fetch("BTC-USD", "1m", start, start + pd.Timedelta(hours=12))
    assert len(recorder.requests) == 3
    assert [r.url.params["granularity"] for r in recorder.requests] == ["60"] * 3
    assert recorder.requests[0].url.path == "/products/BTC-USD/candles"
    assert recorder.requests[1].url.params["start"] == "2026-11-01T05:00:00+00:00"
    bars = result.bars
    assert bars.size == 720
    assert np.all(np.diff(bars.ts_ns) == 60_000_000_000)
    o, h, low, c, v = synthetic_candle(int(start.timestamp()))
    assert (bars.open[0], bars.high[0], bars.low[0], bars.close[0], bars.volume[0]) == (
        o,
        h,
        low,
        c,
        v,
    )
    assert result.source.provider == "coinbase"
    assert result.source.mode == "PUBLIC EXCHANGE DATA"
    assert result.source.terms_url
    assert result.gaps.missing_bars == 0


def test_coinbase_gaps_are_reported_not_filled():
    start = pd.Timestamp("2026-11-01 00:00", tz="UTC")
    first = int(start.timestamp())
    skip = {first + 60 * 10, first + 60 * 11, first + 60 * 50}
    provider, _ = coinbase(coinbase_handler(frozenset(skip)))
    result = provider.fetch("ETH-USD", "1m", start, start + pd.Timedelta(hours=2))
    assert result.bars.size == 117
    assert result.gaps.missing_bars == 3
    assert result.gaps.gap_count == 2
    assert result.gaps.gaps[0].missing_bars == 2
    assert result.gaps.gaps[0].start == pd.Timestamp("2026-11-01 00:10", tz="UTC")
    assert result.gaps.gaps[0].end == pd.Timestamp("2026-11-01 00:12", tz="UTC")


@pytest.mark.parametrize(
    "symbol", ["BTCUSD", "btc-usd", "BTC-USD/../admin", "BTC-USD?x=1", "DOGE-USD", 42, ""]
)
def test_symbols_are_checked_before_any_request(symbol):
    provider, recorder = coinbase(never)
    start = NOW - pd.Timedelta(hours=1)
    with pytest.raises(InvalidSymbolError):
        provider.fetch(symbol, "1m", start, NOW)
    assert recorder.requests == []


def test_bounds_are_enforced_before_any_request():
    provider, recorder = coinbase(never)
    with pytest.raises(OutOfRangeError, match="30 days"):
        provider.fetch("BTC-USD", "1m", NOW - pd.Timedelta(days=31), NOW)
    with pytest.raises(UnsupportedError):
        provider.fetch("BTC-USD", "30m", NOW - pd.Timedelta(days=1), NOW)
    with pytest.raises(OutOfRangeError, match="empty"):
        provider.fetch("BTC-USD", "1h", NOW, NOW - pd.Timedelta(days=1))
    with pytest.raises(OutOfRangeError, match="time zone"):
        provider.fetch("BTC-USD", "1h", pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-02"))
    provider.max_requests = 2
    with pytest.raises(OutOfRangeError, match="more than 2 requests"):
        provider.fetch("BTC-USD", "1m", NOW - pd.Timedelta(hours=12), NOW)
    assert recorder.requests == []


def test_future_end_is_cut_at_the_present():
    provider, _ = coinbase(coinbase_handler())
    result = provider.fetch(
        "BTC-USD", "1h", NOW - pd.Timedelta(hours=5), NOW + pd.Timedelta(days=3)
    )
    assert result.bars.size == 5
    assert result.source.end == NOW


def sequence(*responses):
    queue = list(responses)

    def handle(request):
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    return handle


def test_retries_with_backoff_then_succeed():
    rows = [[int(NOW.timestamp()) - 3_600, 99.5, 100.5, 100.0, 100.2, 1.0]]
    sleeps = []
    provider, recorder = coinbase(
        sequence(httpx2.Response(503), httpx2.Response(502), httpx2.Response(200, json=rows)),
        sleeps,
    )
    result = provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)
    assert result.bars.size == 1
    assert len(recorder.requests) == 3
    assert sleeps == [0.5, 1.0]


def test_retry_after_is_respected_and_retries_are_bounded():
    sleeps = []
    provider, _ = coinbase(
        sequence(
            httpx2.Response(429, headers={"Retry-After": "3"}),
            httpx2.Response(429, headers={"Retry-After": "2"}),
            httpx2.Response(429),
            httpx2.Response(429),
        ),
        sleeps,
    )
    with pytest.raises(RateLimitedError):
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)
    assert sleeps == [3.0, 2.0, 2.0]


def test_long_retry_after_fails_fast():
    sleeps = []
    provider, _ = coinbase(sequence(httpx2.Response(429, headers={"Retry-After": "600"})), sleeps)
    with pytest.raises(RateLimitedError):
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)
    assert sleeps == []


@pytest.mark.parametrize(
    ("response", "error"),
    [
        (httpx2.Response(404, json={"message": "NotFound"}), NotFoundError),
        (httpx2.Response(451), NetworkError),
        (httpx2.Response(400, json={"message": "bad"}), BadPayloadError),
        (httpx2.Response(200, json={"message": "odd"}), BadPayloadError),
        (httpx2.Response(200, text="<html>"), BadPayloadError),
        (httpx2.Response(200, json=[[1, 2, 3]]), BadPayloadError),
        (httpx2.Response(200, json=[]), NotFoundError),
    ],
)
def test_typed_errors(response, error):
    provider, _ = coinbase(sequence(response))
    with pytest.raises(error) as raised:
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)
    assert raised.value.provider == "coinbase"
    assert len(raised.value.user_message) <= 200


def test_invalid_candles_fail_validation_as_bad_payload():
    t = int(NOW.timestamp()) - 3_600
    provider, _ = coinbase(
        sequence(httpx2.Response(200, json=[[t, 101.0, 100.0, 100.5, 100.5, 1]]))
    )
    with pytest.raises(BadPayloadError, match="validation"):
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)


def test_network_failures_are_retried_then_typed():
    sleeps = []
    request = httpx2.Request("GET", "https://example.test")
    provider, recorder = coinbase(
        sequence(*[httpx2.ConnectTimeout("slow", request=request)] * 4), sleeps
    )
    with pytest.raises(NetworkError, match="timed out"):
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=1), NOW)
    assert len(recorder.requests) == 4
    assert sleeps == [0.5, 1.0, 2.0]


def test_rate_limiter_spaces_requests():
    clock = [0.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds

    limiter = RateLimiter(1.0, clock=lambda: clock[0], sleep=sleep)
    for _ in range(3):
        limiter.wait()
    assert sleeps == [1.0, 1.0]


def test_global_fetch_slots_limit_concurrency():
    slots = threading.BoundedSemaphore(1)
    with fetch_slot(slots, wait=0), pytest.raises(BusyError), fetch_slot(slots, wait=0):
        pass
    with fetch_slot(slots, wait=0):
        pass


def test_fetch_budget_counts_requests_and_time():
    clock = [0.0]
    budget = FetchBudget(max_requests=2, max_seconds=10, clock=lambda: clock[0])
    budget.take("p")
    budget.take("p")
    with pytest.raises(OutOfRangeError):
        budget.take("p")
    late = FetchBudget(max_requests=5, max_seconds=10, clock=lambda: clock[0])
    clock[0] = 11
    with pytest.raises(RateLimitedError):
        late.take("p")


def kraken(handler):
    built, recorder = fetcher(handler, "kraken")
    return KrakenCandles(built, now), recorder


def test_kraken_candles_drop_the_uncommitted_last_candle():
    current = NOW.floor("1h")
    rows = kraken_ohlc(60, 24, current)

    def handle(request):
        return httpx2.Response(200, json={"error": [], "result": {"XXBTZUSD": rows, "last": 1}})

    provider, recorder = kraken(handle)
    result = provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=10), NOW)
    params = recorder.requests[0].url.params
    assert (params["pair"], params["interval"]) == ("XBTUSD", "60")
    assert result.bars.size == 10
    assert result.bars.timestamp(result.bars.size - 1) == current - pd.Timedelta(hours=1)
    assert result.source.provider == "kraken"


def test_kraken_history_limit_is_a_range_error():
    provider, recorder = kraken(never)
    with pytest.raises(OutOfRangeError, match="history"):
        provider.fetch("BTC-USD", "1m", NOW - pd.Timedelta(days=1), NOW)
    assert recorder.requests == []
    info = provider.info()
    assert info.history_days["1m"] == pytest.approx(719 / 1_440)
    assert info.history_days["1d"] == 719


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({"error": ["EQuery:Unknown asset pair"]}, NotFoundError),
        ({"error": ["EGeneral:Internal error"]}, BadPayloadError),
        ({"result": {}}, BadPayloadError),
        ({"error": [], "result": {"A": [], "B": []}}, BadPayloadError),
        ({"error": [], "result": {"A": [["x", 1, 2, 3, 4, 5, 6, 7]]}}, BadPayloadError),
    ],
)
def test_kraken_errors(payload, error):
    provider, _ = kraken(sequence(httpx2.Response(200, json=payload)))
    with pytest.raises(error):
        provider.fetch("BTC-USD", "1h", NOW - pd.Timedelta(hours=10), NOW)


def trade_rows(start_s: float, count: int, spacing: float):
    return [
        [
            f"{100 + i * 0.01:.2f}",
            f"{0.1 + (i % 3) * 0.05:.3f}",
            start_s + i * spacing,
            "bs"[i % 2],
            "l",
            "",
            i,
        ]
        for i in range(count)
    ]


def test_kraken_trades_paginate_by_last_and_stop_at_the_end():
    start = NOW - pd.Timedelta(hours=2)
    start_s = start.timestamp()
    pages = [trade_rows(start_s, 1_000, 3.0), trade_rows(start_s + 3_000, 1_000, 3.0)]
    seen = []

    def handle(request):
        seen.append(request.url.params["since"])
        rows = pages.pop(0)
        last = str(int(rows[-1][2] * 1e9))
        return httpx2.Response(200, json={"error": [], "result": {"XXBTZUSD": rows, "last": last}})

    built, _ = fetcher(handle, "kraken_trades")
    result = KrakenTrades(built, now).fetch("BTC-USD", start, start + pd.Timedelta(hours=1))
    assert seen[0] == str(int(start_s))
    assert seen[1] == str(int((start_s + 2_997) * 1e9))
    assert result.time_ns.size == 1_200
    assert result.buy[:4].tolist() == [True, False, True, False]
    assert not result.truncated
    assert result.covered_until == start + pd.Timedelta(hours=1)
    assert result.source.mode == "PUBLIC EXCHANGE DATA"


def test_kraken_trades_are_truncated_honestly_at_the_request_bound():
    start = NOW - pd.Timedelta(hours=5)
    start_s = start.timestamp()
    calls = [0]

    def handle(request):
        rows = trade_rows(start_s + calls[0] * 1_000, 1_000, 1.0)
        calls[0] += 1
        last = str(int(rows[-1][2] * 1e9))
        return httpx2.Response(200, json={"error": [], "result": {"XXBTZUSD": rows, "last": last}})

    built, _ = fetcher(handle, "kraken_trades")
    provider = KrakenTrades(built, now)
    provider.max_requests = 2
    result = provider.fetch("BTC-USD", start, start + pd.Timedelta(hours=4))
    assert result.truncated
    assert result.time_ns.size == 2_000
    assert result.covered_until == pd.Timestamp(start_s + 1_999, unit="s", tz="UTC")


def test_kraken_trade_window_is_bounded():
    built, recorder = fetcher(never, "kraken_trades")
    with pytest.raises(OutOfRangeError):
        KrakenTrades(built, now).fetch("BTC-USD", NOW - pd.Timedelta(hours=7), NOW)
    assert recorder.requests == []


def test_archive_files_use_months_when_complete():
    window = Window(
        start=pd.Timestamp("2026-08-30", tz="UTC"),
        end=pd.Timestamp("2026-10-03", tz="UTC"),
        timeframe="1h",
    )
    files = archive_files(window, "BTCUSDT", pd.Timestamp("2026-11-03").date())
    assert files == [
        ("daily", "BTCUSDT-1h-2026-08-30.zip"),
        ("daily", "BTCUSDT-1h-2026-08-31.zip"),
        ("monthly", "BTCUSDT-1h-2026-09.zip"),
        ("daily", "BTCUSDT-1h-2026-10-01.zip"),
        ("daily", "BTCUSDT-1h-2026-10-02.zip"),
    ]


def archive_handler(files, corrupt=frozenset()):
    def handle(request):
        name = request.url.path.rsplit("/", 1)[-1]
        if request.url.host != "data.binance.vision":
            raise AssertionError(request.url)
        if name.endswith(".CHECKSUM"):
            content = files[name.removesuffix(".CHECKSUM")][1]
            if name.removesuffix(".CHECKSUM") in corrupt:
                content = b"0" * 64 + b"  x.zip\n"
            return httpx2.Response(200, content=content)
        if name not in files:
            return httpx2.Response(404)
        return httpx2.Response(200, content=files[name][0])

    return handle


def binance(handler):
    built, recorder = fetcher(handler, "binance_archive")
    return BinanceArchive(built, now), recorder


def test_binance_archive_verifies_and_parses_milli_and_microseconds():
    day1 = pd.Timestamp("2026-10-30", tz="UTC")
    day2 = pd.Timestamp("2026-10-31", tz="UTC")
    files = {
        "BTCUSDT-1h-2026-10-30.zip": kline_zip("BTCUSDT-1h-2026-10-30.zip", day1, 24, 60),
        "BTCUSDT-1h-2026-10-31.zip": kline_zip(
            "BTCUSDT-1h-2026-10-31.zip", day2, 24, 60, micro=True, header=True
        ),
    }
    provider, recorder = binance(archive_handler(files))
    result = provider.fetch("BTC-USDT", "1h", day1, day1 + pd.Timedelta(days=2))
    assert result.bars.size == 48
    assert np.all(np.diff(result.bars.ts_ns) == 3_600 * 10**9)
    assert result.bars.timestamp(24) == day2
    assert len(recorder.requests) == 4
    assert all("api.binance.com" not in str(r.url) for r in recorder.requests)


def test_binance_archive_rejects_checksum_mismatch():
    day = pd.Timestamp("2026-10-30", tz="UTC")
    name = "BTCUSDT-1h-2026-10-30.zip"
    provider, _ = binance(archive_handler({name: kline_zip(name, day, 24, 60)}, {name}))
    with pytest.raises(BadPayloadError, match="checksum"):
        provider.fetch("BTC-USDT", "1h", day, day + pd.Timedelta(days=1))


def test_binance_archive_cuts_today_and_bounds_files():
    day = pd.Timestamp("2026-11-02", tz="UTC")
    name = "BTCUSDT-1h-2026-11-02.zip"
    provider, _ = binance(archive_handler({name: kline_zip(name, day, 24, 60)}))
    result = provider.fetch("BTC-USDT", "1h", day, NOW)
    assert result.bars.size == 24
    assert result.warnings
    with pytest.raises(OutOfRangeError, match="complete past days"):
        provider.fetch("BTC-USDT", "1h", NOW.normalize(), NOW)
    with pytest.raises(OutOfRangeError, match="archive files"):
        provider.fetch(
            "BTC-USDT",
            "5m",
            pd.Timestamp("2026-05-02", tz="UTC"),
            pd.Timestamp("2026-07-31", tz="UTC"),
        )


def test_binance_archive_missing_file_is_not_found():
    provider, _ = binance(archive_handler({}))
    day = pd.Timestamp("2026-10-30", tz="UTC")
    with pytest.raises(NotFoundError):
        provider.fetch("BTC-USDT", "1h", day, day + pd.Timedelta(days=1))
