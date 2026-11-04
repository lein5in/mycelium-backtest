import httpx2

from app.config import Settings
from app.data.cache import DiskCache
from app.data.refresh import DEFAULT_ITEMS, main, parse_items
from app.data.registry import DataRegistry
from tests.data.fakes import coinbase_handler, now


def setup(tmp_path, items, handler=None):
    settings = Settings(_env_file=None, refresh_items=items, cache_dir=tmp_path / "cache")
    handler = handler or coinbase_handler()
    calls = []

    def recorded(request):
        calls.append(request)
        return handler(request)

    def factory():
        return httpx2.Client(transport=httpx2.MockTransport(recorded))

    registry = DataRegistry(settings, client_factory=factory, now=now)
    registry._limiters["coinbase"].min_interval = 0.0
    cache = DiskCache(tmp_path / "cache", 10**9, 30 * 86_400, 60)
    return settings, registry, cache, calls


def test_parse_items_defaults_and_problems():
    items, problems = parse_items("")
    assert len(items) == len(DEFAULT_ITEMS)
    items, problems = parse_items("coinbase:BTC-USD:1h:3, bad, coinbase:ETH-USD:1h:x")
    assert [item.label for item in items] == ["coinbase BTC-USD 1h 3d"]
    assert len(problems) == 2


def test_refresh_warms_the_cache_and_is_idempotent(tmp_path):
    lines = []
    settings, registry, cache, calls = setup(
        tmp_path, "coinbase:BTC-USD:1h:3,coinbase:ETH-USD:1d:20"
    )
    assert main([], settings, registry, cache, lines.append) == 0
    first_calls = len(calls)
    assert first_calls > 0
    assert lines[-1].startswith("summary: 2 ok, 0 failed")
    again = []
    settings, registry2, _, calls2 = setup(tmp_path, "coinbase:BTC-USD:1h:3,coinbase:ETH-USD:1d:20")
    assert main([], settings, registry2, cache, again.append) == 0
    assert "already cached" in again[0]
    assert sum(1 for request in calls2) <= 2


def test_partial_failure_exits_zero_and_total_failure_exits_one(tmp_path):
    lines = []
    settings, registry, cache, _ = setup(tmp_path, "coinbase:BTC-USD:1h:3,kraken:BTC-USD:1h:3")
    assert main([], settings, registry, cache, lines.append) == 0
    assert any(line.startswith("failed  kraken") for line in lines)
    lines = []
    settings, registry, cache, _ = setup(
        tmp_path, "coinbase:DOGE-USD:1h:3", lambda request: httpx2.Response(500)
    )
    assert main([], settings, registry, cache, lines.append) == 1
    assert "1 failed" in lines[-1]


def test_network_errors_are_reported_per_item(tmp_path):
    lines = []
    settings, registry, cache, _ = setup(
        tmp_path, "coinbase:BTC-USD:1h:3", lambda request: httpx2.Response(404)
    )
    assert main([], settings, registry, cache, lines.append) == 1
    assert lines[0].startswith("failed  coinbase BTC-USD 1h 3d")
