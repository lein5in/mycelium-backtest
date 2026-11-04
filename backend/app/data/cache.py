import io
import os
import re
import tempfile
import threading
import time
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from app.data.base import CandleProvider
from app.data.catalog import Window, check_symbol
from app.data.errors import BadPayloadError, NotFoundError
from app.data.models import DataResult
from app.engine.bars import BarsValidationError, validate_bars
from app.engine.sessions import NS_PER_DAY

CACHEABLE = frozenset({"coinbase", "binance_archive"})
CHUNK_DAYS = {"1m": 1, "5m": 7, "15m": 14, "30m": 30, "1h": 30, "4h": 180, "1d": 360}
ARRAYS = ("ts_ns", "open", "high", "low", "close", "volume")
PART = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
SUFFIX = ".npz"

Arrays = dict[str, np.ndarray]
Clock = Callable[[], float]


@dataclass(frozen=True)
class ChunkKey:
    provider: str
    symbol: str
    timeframe: str
    start_ns: int

    def __post_init__(self) -> None:
        if self.provider not in CACHEABLE:
            raise ValueError(f"{self.provider!r} data is never cached")
        for part in (self.symbol, self.timeframe):
            if not PART.fullmatch(part):
                raise ValueError(f"invalid cache key part {part!r}")

    @property
    def filename(self) -> str:
        return f"{self.provider}__{self.symbol}__{self.timeframe}__{self.start_ns}{SUFFIX}"

    @property
    def end_ns(self) -> int:
        return self.start_ns + CHUNK_DAYS[self.timeframe] * NS_PER_DAY


def chunk_starts(timeframe: str, start_ns: int, end_ns: int) -> list[int]:
    size = CHUNK_DAYS[timeframe] * NS_PER_DAY
    first = start_ns - start_ns % size
    return list(range(first, end_ns, size))


def empty_arrays() -> Arrays:
    return {name: np.empty(0, dtype=np.int64 if name == "ts_ns" else np.float64) for name in ARRAYS}


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    discarded: int = 0
    evicted: int = 0


@dataclass
class DiskCache:
    directory: Path
    max_bytes: int
    ttl_closed_seconds: float
    ttl_live_seconds: float
    clock: Clock = time.time
    stats: CacheStats = field(default_factory=CacheStats)
    _locks: dict[str, threading.Lock] = field(default_factory=dict, init=False)
    _guard: threading.Lock = field(default_factory=threading.Lock, init=False)

    def __post_init__(self) -> None:
        self.directory = Path(self.directory)

    def path(self, key: ChunkKey) -> Path:
        return self.directory / key.filename

    def _lock(self, key: ChunkKey) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key.filename, threading.Lock())

    def _discard(self, path: Path) -> None:
        self.stats.discarded += 1
        path.unlink(missing_ok=True)

    def read(self, key: ChunkKey, now_ns: int) -> Arrays | None:
        path = self.path(key)
        if not path.is_file():
            return None
        try:
            with np.load(io.BytesIO(path.read_bytes()), allow_pickle=False) as stored:
                if set(stored.files) != {*ARRAYS, "written_at"}:
                    raise ValueError("unexpected arrays")
                arrays = {name: stored[name] for name in ARRAYS}
                written_at = float(stored["written_at"])
        except (OSError, ValueError, KeyError, EOFError, zipfile.BadZipFile):
            self._discard(path)
            return None
        sizes = {array.size for array in arrays.values()}
        if (
            len(sizes) != 1
            or any(array.ndim != 1 for array in arrays.values())
            or arrays["ts_ns"].dtype != np.int64
            or any(arrays[name].dtype != np.float64 for name in ARRAYS[1:])
        ):
            self._discard(path)
            return None
        closed = key.end_ns <= now_ns
        ttl = self.ttl_closed_seconds if closed else self.ttl_live_seconds
        if self.clock() - written_at > ttl:
            return None
        now = self.clock()
        os.utime(path, (now, now))
        return arrays

    def write(self, key: ChunkKey, arrays: Arrays) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        temp: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=self.directory, prefix=".chunk-", suffix=".tmp", delete=False
            ) as handle:
                temp = Path(handle.name)
                np.savez(
                    handle,
                    written_at=np.float64(self.clock()),
                    **{name: arrays[name] for name in ARRAYS},
                )
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, self.path(key))
        except BaseException:
            if temp is not None:
                temp.unlink(missing_ok=True)
            raise
        now = self.clock()
        os.utime(self.path(key), (now, now))
        self.evict()

    def get_or_fetch(
        self, key: ChunkKey, now_ns: int, fetch: Callable[[], Arrays]
    ) -> tuple[Arrays, bool]:
        with self._lock(key):
            cached = self.read(key, now_ns)
            if cached is not None:
                self.stats.hits += 1
                return cached, True
            self.stats.misses += 1
            arrays = fetch()
            self.write(key, arrays)
            return arrays, False

    def size(self) -> int:
        return sum(path.stat().st_size for path in self.directory.glob(f"*{SUFFIX}"))

    def evict(self) -> None:
        files = sorted(self.directory.glob(f"*{SUFFIX}"), key=lambda p: p.stat().st_mtime)
        total = sum(path.stat().st_size for path in files)
        for path in files:
            if total <= self.max_bytes:
                break
            total -= path.stat().st_size
            path.unlink(missing_ok=True)
            self.stats.evicted += 1


def _arrays(result: DataResult) -> Arrays:
    bars = result.bars
    return {
        "ts_ns": bars.ts_ns.astype(np.int64),
        "open": bars.open,
        "high": bars.high,
        "low": bars.low,
        "close": bars.close,
        "volume": bars.volume,
    }


class CachedCandles:
    def __init__(self, provider: CandleProvider, cache: DiskCache) -> None:
        if provider.id not in CACHEABLE:
            raise ValueError(f"{provider.id!r} data is never cached")
        self.provider = provider
        self.cache = cache

    def chunks(self, symbol: str, window: Window) -> list[ChunkKey]:
        return [
            ChunkKey(self.provider.id, symbol, window.timeframe, start)
            for start in chunk_starts(window.timeframe, window.start.value, window.end.value)
        ]

    def _fetch_chunk(self, symbol: str, key: ChunkKey, now: pd.Timestamp) -> Arrays:
        start = pd.Timestamp(key.start_ns, tz="UTC")
        end = min(pd.Timestamp(key.end_ns, tz="UTC"), now)
        try:
            return _arrays(self.provider.fetch(symbol, key.timeframe, start, end))
        except NotFoundError:
            return empty_arrays()

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> DataResult:
        check_symbol(symbol, self.provider.symbols, self.provider.id)
        window = self.provider.window(start, end, timeframe)
        now = self.provider.now()
        parts = []
        for key in self.chunks(symbol, window):
            arrays, _ = self.cache.get_or_fetch(
                key, now.value, lambda key=key: self._fetch_chunk(symbol, key, now)
            )
            parts.append(arrays)
        merged = {name: np.concatenate([part[name] for part in parts]) for name in ARRAYS}
        keep = (merged["ts_ns"] >= window.start.value) & (merged["ts_ns"] < window.end.value)
        if not keep.any():
            raise NotFoundError("No candles were returned for this range.", self.provider.id)
        index = pd.DatetimeIndex(merged["ts_ns"][keep].astype("datetime64[ns]")).tz_localize("UTC")
        frame = pd.DataFrame({name: merged[name][keep] for name in ARRAYS[1:]}, index=index)
        try:
            bars = validate_bars(frame, window.timeframe)
        except BarsValidationError as error:
            message = f"Cached data failed validation: {error}"
            raise BadPayloadError(message, self.provider.id) from error
        return self.provider.result(symbol, window, bars)
