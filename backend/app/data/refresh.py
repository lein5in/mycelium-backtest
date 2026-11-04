import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import pandas as pd

from app.config import Settings, get_settings
from app.data.cache import CACHEABLE, CachedCandles, DiskCache
from app.data.errors import DataError
from app.data.registry import DataRegistry

DEFAULT_ITEMS = (
    "coinbase:BTC-USD:5m:7",
    "coinbase:ETH-USD:5m:7",
    "coinbase:BTC-USD:1h:90",
    "coinbase:ETH-USD:1h:90",
    "coinbase:SOL-USD:1h:90",
    "coinbase:BTC-USD:1d:365",
    "coinbase:ETH-USD:1d:365",
)
MAX_ITEMS = 50

Output = Callable[[str], None]


@dataclass(frozen=True)
class RefreshItem:
    provider: str
    symbol: str
    timeframe: str
    days: float

    @property
    def label(self) -> str:
        return f"{self.provider} {self.symbol} {self.timeframe} {self.days:g}d"


@dataclass(frozen=True)
class ItemOutcome:
    item: RefreshItem | None
    text: str
    fetched: int = 0
    skipped: int = 0
    error: str | None = None


def parse_items(text: str) -> tuple[list[RefreshItem], list[str]]:
    entries = [entry.strip() for entry in text.split(",") if entry.strip()] or list(DEFAULT_ITEMS)
    items: list[RefreshItem] = []
    problems: list[str] = []
    for entry in entries[:MAX_ITEMS]:
        parts = entry.split(":")
        if len(parts) != 4:
            problems.append(f"{entry!r}: expected provider:symbol:timeframe:days")
            continue
        provider, symbol, timeframe, days = parts
        try:
            value = float(days)
        except ValueError:
            problems.append(f"{entry!r}: days must be a number")
            continue
        if not 0 < value <= 3_650:
            problems.append(f"{entry!r}: days must be between 0 and 3650")
            continue
        items.append(RefreshItem(provider, symbol, timeframe, value))
    if len(entries) > MAX_ITEMS:
        problems.append(f"only the first {MAX_ITEMS} items are used")
    return items, problems


def refresh(
    items: Sequence[RefreshItem], registry: DataRegistry, cache: DiskCache
) -> list[ItemOutcome]:
    outcomes = []
    for item in items:
        if item.provider not in CACHEABLE:
            outcomes.append(
                ItemOutcome(item, f"failed  {item.label}: this source is not cached", error="cache")
            )
            continue
        before_hits, before_misses = cache.stats.hits, cache.stats.misses
        try:
            source = CachedCandles(registry.candles(item.provider), cache)
            now = registry.now()
            result = source.fetch(
                item.symbol, item.timeframe, now - pd.Timedelta(days=item.days), now
            )
        except DataError as error:
            outcomes.append(
                ItemOutcome(item, f"failed  {item.label}: {error.user_message}", error=error.code)
            )
            continue
        fetched = cache.stats.misses - before_misses
        skipped = cache.stats.hits - before_hits
        outcomes.append(
            ItemOutcome(
                item,
                f"ok      {item.label}: {result.bars.size:,} bars, {fetched} chunk(s) fetched, "
                f"{skipped} already cached, {result.gaps.missing_bars:,} missing bars",
                fetched=fetched,
                skipped=skipped,
            )
        )
    return outcomes


def main(
    argv: Sequence[str] | None = None,
    settings: Settings | None = None,
    registry: DataRegistry | None = None,
    cache: DiskCache | None = None,
    out: Output = print,
) -> int:
    settings = settings or get_settings()
    items, problems = parse_items(settings.refresh_items)
    registry = registry or DataRegistry(settings)
    cache = cache or DiskCache(
        directory=settings.cache_dir,
        max_bytes=int(settings.cache_max_mb * 1024 * 1024),
        ttl_closed_seconds=settings.cache_ttl_closed_days * 86_400,
        ttl_live_seconds=settings.cache_ttl_live_seconds,
    )
    for problem in problems:
        out(f"skipped {problem}")
    try:
        outcomes = refresh(items, registry, cache)
    finally:
        registry.close()
    for outcome in outcomes:
        out(outcome.text)
    failed = sum(1 for outcome in outcomes if outcome.error)
    fetched = sum(outcome.fetched for outcome in outcomes)
    skipped = sum(outcome.skipped for outcome in outcomes)
    out(
        f"summary: {len(outcomes) - failed} ok, {failed} failed, {len(problems)} skipped; "
        f"{fetched} chunk(s) fetched, {skipped} already cached; cache {cache.size():,} bytes"
    )
    total_failure = not outcomes or failed == len(outcomes)
    return 1 if total_failure else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
