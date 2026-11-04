import hashlib
import hmac
import math
import secrets
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

from app.errors import ApiError

Clock = Callable[[], float]
HOUR = 3_600.0
CONCURRENT_RETRY_SECONDS = 10
PRUNE_EVERY = 1_024


class ClientKeys:
    def __init__(self, forwarded_hops: int) -> None:
        self.forwarded_hops = forwarded_hops
        self._secret = secrets.token_bytes(32)

    def address(self, peer: str | None, forwarded_for: str | None) -> str:
        if self.forwarded_hops and forwarded_for:
            hops = [part.strip() for part in forwarded_for.split(",") if part.strip()]
            if len(hops) >= self.forwarded_hops:
                return hops[-self.forwarded_hops]
        return peer or "unknown"

    def key(self, peer: str | None, forwarded_for: str | None) -> str:
        address = self.address(peer, forwarded_for).encode("utf-8", "replace")
        return hmac.new(self._secret, address, hashlib.sha256).hexdigest()[:32]


@dataclass
class _Usage:
    starts: deque[float] = field(default_factory=deque)
    active: int = 0


class RunQuota:
    def __init__(self, per_hour: int, concurrent: int, clock: Clock = time.monotonic) -> None:
        self.per_hour = per_hour
        self.concurrent = concurrent
        self.clock = clock
        self._usage: dict[str, _Usage] = {}
        self._lock = threading.Lock()

    def _expire(self, usage: _Usage, now: float) -> None:
        while usage.starts and now - usage.starts[0] >= HOUR:
            usage.starts.popleft()

    def acquire(self, key: str) -> None:
        now = self.clock()
        with self._lock:
            usage = self._usage.setdefault(key, _Usage())
            self._expire(usage, now)
            if usage.active >= self.concurrent:
                raise ApiError(
                    "rate_limited",
                    f"You already have {usage.active} run(s) in progress; wait for one to finish.",
                    retry_after=CONCURRENT_RETRY_SECONDS,
                )
            if len(usage.starts) >= self.per_hour:
                wait = math.ceil(HOUR - (now - usage.starts[0]))
                raise ApiError(
                    "rate_limited",
                    f"The limit is {self.per_hour} runs per hour; try again later.",
                    retry_after=max(1, wait),
                )
            usage.starts.append(now)
            usage.active += 1

    def release(self, key: str) -> None:
        with self._lock:
            usage = self._usage.get(key)
            if usage is None:
                return
            usage.active = max(0, usage.active - 1)
            self._expire(usage, self.clock())
            if usage.active == 0 and not usage.starts:
                del self._usage[key]

    def tracked(self) -> int:
        with self._lock:
            return len(self._usage)


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RequestRate:
    def __init__(self, per_minute: int, clock: Clock = time.monotonic) -> None:
        self.capacity = float(per_minute)
        self.rate = per_minute / 60.0
        self.clock = clock
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._hits = 0

    def hit(self, key: str) -> int | None:
        now = self.clock()
        with self._lock:
            self._hits += 1
            if self._hits % PRUNE_EVERY == 0:
                self._prune(now)
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = self._buckets[key] = _Bucket(self.capacity, now)
            bucket.tokens = min(self.capacity, bucket.tokens + (now - bucket.updated) * self.rate)
            bucket.updated = now
            if bucket.tokens < 1.0:
                return max(1, math.ceil((1.0 - bucket.tokens) / self.rate))
            bucket.tokens -= 1.0
            return None

    def _prune(self, now: float) -> None:
        full = self.capacity / self.rate
        stale = [key for key, bucket in self._buckets.items() if now - bucket.updated > full]
        for key in stale:
            del self._buckets[key]
