import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field

import httpx2

from app.data.errors import (
    BadPayloadError,
    BusyError,
    DataError,
    NetworkError,
    NotFoundError,
    OutOfRangeError,
    RateLimitedError,
)

Clock = Callable[[], float]
Sleep = Callable[[float], None]

USER_AGENT = "mycelium-backtest/0.1 (research backtesting; public endpoints only)"
MAX_CONCURRENT_FETCHES = 4
SLOT_WAIT_SECONDS = 10.0
MAX_RETRY_AFTER_SECONDS = 30.0
RETRY_STATUSES = {429, 500, 502, 503, 504}


class RateLimiter:
    def __init__(
        self, min_interval: float, clock: Clock = time.monotonic, sleep: Sleep = time.sleep
    ):
        self.min_interval = min_interval
        self.clock = clock
        self.sleep = sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = self.clock()
            delay = self._next - now
            if delay > 0:
                self.sleep(delay)
                now = self.clock()
            self._next = max(now, self._next) + self.min_interval


FETCH_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_FETCHES)


@contextmanager
def fetch_slot(
    semaphore: threading.BoundedSemaphore = FETCH_SLOTS, wait: float = SLOT_WAIT_SECONDS
) -> Iterator[None]:
    if not semaphore.acquire(timeout=wait):
        raise BusyError("Too many data fetches are running; try again in a moment.")
    try:
        yield
    finally:
        semaphore.release()


@dataclass
class FetchBudget:
    max_requests: int
    max_seconds: float
    clock: Clock = time.monotonic
    started: float = field(init=False)
    requests: int = field(init=False, default=0)

    def __post_init__(self) -> None:
        self.started = self.clock()

    def remaining_seconds(self) -> float:
        return self.max_seconds - (self.clock() - self.started)

    def take(self, provider: str) -> None:
        if self.requests >= self.max_requests:
            raise OutOfRangeError(
                f"This range needs more than {self.max_requests} requests; choose a shorter range.",
                provider,
            )
        if self.remaining_seconds() <= 0:
            raise RateLimitedError(
                "The data source took too long to answer; try a shorter range later.", provider
            )
        self.requests += 1


def _retry_after(response: httpx2.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


class HttpFetcher:
    def __init__(
        self,
        provider: str,
        display_name: str,
        client: httpx2.Client,
        limiter: RateLimiter,
        sleep: Sleep = time.sleep,
        max_retries: int = 3,
        backoff_seconds: float = 0.5,
    ) -> None:
        self.provider = provider
        self.display_name = display_name
        self.client = client
        self.limiter = limiter
        self.sleep = sleep
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds

    def _fail(self, error: type[DataError], message: str) -> DataError:
        return error(f"{self.display_name}: {message}", self.provider)

    def request(
        self, url: str, params: Mapping[str, str | int] | None, budget: FetchBudget
    ) -> httpx2.Response:
        attempt = 0
        while True:
            budget.take(self.provider)
            self.limiter.wait()
            timeout = max(1.0, min(20.0, budget.remaining_seconds()))
            try:
                response = self.client.get(
                    url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT}
                )
            except httpx2.TimeoutException:
                failure = self._fail(NetworkError, "the request timed out.")
                delay = None
            except httpx2.TransportError:
                failure = self._fail(NetworkError, "the data source could not be reached.")
                delay = None
            else:
                status = response.status_code
                if status < 400:
                    return response
                if status == 404:
                    raise self._fail(NotFoundError, "no data was found for this request.")
                if status == 451:
                    raise self._fail(
                        NetworkError, "the data source refuses requests from this location."
                    )
                if status not in RETRY_STATUSES:
                    raise self._fail(BadPayloadError, f"the request was refused (HTTP {status}).")
                error = RateLimitedError if status == 429 else NetworkError
                failure = self._fail(
                    error,
                    "too many requests; try again later."
                    if status == 429
                    else f"the data source had an error (HTTP {status}).",
                )
                delay = _retry_after(response)
            if attempt >= self.max_retries:
                raise failure
            wait = self.backoff_seconds * 2**attempt if delay is None else delay
            if wait > MAX_RETRY_AFTER_SECONDS or wait >= budget.remaining_seconds():
                raise failure
            self.sleep(wait)
            attempt += 1

    def get_json(
        self, url: str, params: Mapping[str, str | int] | None, budget: FetchBudget
    ) -> object:
        response = self.request(url, params, budget)
        try:
            return response.json()
        except ValueError as error:
            raise self._fail(BadPayloadError, "the answer was not valid JSON.") from error

    def get_bytes(self, url: str, budget: FetchBudget, max_bytes: int) -> bytes:
        response = self.request(url, None, budget)
        content = response.content
        if len(content) > max_bytes:
            raise self._fail(BadPayloadError, f"the file is larger than {max_bytes:,} bytes.")
        return content


def default_client() -> httpx2.Client:
    return httpx2.Client(follow_redirects=False)
