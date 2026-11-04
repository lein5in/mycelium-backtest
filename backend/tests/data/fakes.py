import hashlib
import io
import zipfile

import httpx2
import numpy as np
import pandas as pd

from app.data.http import HttpFetcher, RateLimiter

NOW = pd.Timestamp("2026-11-03 12:00", tz="UTC")


def now():
    return NOW


class Recorder:
    def __init__(self, handler):
        self.handler = handler
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self.handler(request)


def fetcher(handler, provider="test", sleeps=None, retries=3):
    recorder = Recorder(handler)
    client = httpx2.Client(transport=httpx2.MockTransport(recorder))
    sleep = sleeps.append if sleeps is not None else (lambda seconds: None)
    built = HttpFetcher(
        provider, provider, client, RateLimiter(0.0), sleep=sleep, max_retries=retries
    )
    return built, recorder


def synthetic_candle(seconds: int) -> tuple[float, float, float, float, float]:
    base = 100.0 + (seconds // 60 % 97) * 0.1
    return (base, base + 0.5, base - 0.5, base + 0.2, 10.0 + seconds % 7)


def coinbase_handler(skip=frozenset()):
    def handle(request: httpx2.Request) -> httpx2.Response:
        params = request.url.params
        granularity = int(params["granularity"])
        start = int(pd.Timestamp(params["start"]).timestamp())
        end = int(pd.Timestamp(params["end"]).timestamp())
        rows = []
        for t in range(start, end + 1, granularity):
            if t in skip:
                continue
            o, h, low, c, v = synthetic_candle(t)
            rows.append([t, low, h, o, c, v])
        return httpx2.Response(200, json=rows[::-1])

    return handle


def kraken_ohlc(interval_minutes: int, count: int, last_open: pd.Timestamp):
    step = interval_minutes * 60
    last = int(last_open.timestamp())
    rows = []
    for t in range(last - (count - 1) * step, last + 1, step):
        o, h, low, c, v = synthetic_candle(t)
        rows.append([t, f"{o}", f"{h}", f"{low}", f"{c}", f"{c}", f"{v}", 5])
    return rows


def kline_zip(name: str, start: pd.Timestamp, count: int, minutes: int, micro=False, header=False):
    step = minutes * 60
    lines = []
    if header:
        lines.append("open_time,open,high,low,close,volume,close_time,qv,n,tb,tq,ignore")
    first = int(start.timestamp())
    for t in range(first, first + count * step, step):
        o, h, low, c, v = synthetic_candle(t)
        stamp = t * (1_000_000 if micro else 1_000)
        lines.append(f"{stamp},{o},{h},{low},{c},{v},{stamp + step * 1000 - 1},0,1,0,0,0")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name.replace(".zip", ".csv"), "\n".join(lines) + "\n")
    content = buffer.getvalue()
    checksum = f"{hashlib.sha256(content).hexdigest()}  {name}\n".encode()
    return content, checksum


def series_ns(bars) -> np.ndarray:
    return bars.ts_ns
