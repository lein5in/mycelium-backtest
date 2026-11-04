from collections.abc import Callable

import httpx2

from app.config import Settings
from app.data import csv_import, samples, yahoo
from app.data.base import CandleProvider, Now, utc_now
from app.data.binance_archive import BinanceArchive
from app.data.coinbase import CoinbaseCandles
from app.data.errors import ProviderDisabledError, UnsupportedError
from app.data.http import HttpFetcher, RateLimiter, default_client
from app.data.kraken import SYMBOLS as KRAKEN_SYMBOLS
from app.data.kraken import TRADE_WINDOW_HOURS, KrakenCandles, KrakenTrades
from app.data.models import ProviderInfo

MIN_INTERVALS = {"coinbase": 0.15, "kraken": 1.1, "kraken_trades": 1.1, "binance_archive": 0.2}
CANDLE_PROVIDERS: dict[str, type[CandleProvider]] = {
    "coinbase": CoinbaseCandles,
    "kraken": KrakenCandles,
    "binance_archive": BinanceArchive,
}
DISABLED_MESSAGES = {
    "yahoo": "The Yahoo adapter is for personal use only and is switched off here.",
    "binance_archive": "The Binance archive adapter is switched off here.",
}

ClientFactory = Callable[[], httpx2.Client]


class DataRegistry:
    def __init__(
        self,
        settings: Settings,
        client_factory: ClientFactory = default_client,
        now: Now = utc_now,
        yahoo_loader: yahoo.Loader = yahoo.load_yfinance,
    ) -> None:
        self.settings = settings
        self.client_factory = client_factory
        self.now = now
        self.yahoo_loader = yahoo_loader
        self._limiters = {name: RateLimiter(value) for name, value in MIN_INTERVALS.items()}
        self._client: httpx2.Client | None = None

    def enabled(self, provider_id: str) -> bool:
        if provider_id == "yahoo":
            return self.settings.enable_yahoo
        if provider_id == "binance_archive":
            return self.settings.enable_binance_archive
        return provider_id in CANDLE_PROVIDERS or provider_id in ("kraken_trades", "samples")

    def _fetcher(self, provider_id: str, display_name: str) -> HttpFetcher:
        if self._client is None:
            self._client = self.client_factory()
        return HttpFetcher(provider_id, display_name, self._client, self._limiters[provider_id])

    def candles(self, provider_id: str) -> CandleProvider | yahoo.YahooCandles:
        if provider_id != "yahoo" and provider_id not in CANDLE_PROVIDERS:
            raise UnsupportedError(f"Unknown candle source {provider_id!r}.", provider_id)
        if not self.enabled(provider_id):
            raise ProviderDisabledError(DISABLED_MESSAGES[provider_id], provider_id)
        if provider_id == "yahoo":
            return yahoo.YahooCandles(self.yahoo_loader, self.now)
        provider = CANDLE_PROVIDERS[provider_id]
        return provider(self._fetcher(provider_id, provider.display_name), self.now)

    def trades(self) -> KrakenTrades:
        return KrakenTrades(self._fetcher("kraken_trades", KrakenTrades.display_name), self.now)

    def providers(self) -> list[ProviderInfo]:
        return [
            CoinbaseCandles.info(enabled=True),
            KrakenCandles.info(enabled=True),
            kraken_trades_info(),
            BinanceArchive.info(enabled=self.settings.enable_binance_archive),
            samples.info(),
            csv_import.info(),
            yahoo.info(self.settings.enable_yahoo),
        ]

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None


def kraken_trades_info() -> ProviderInfo:
    return ProviderInfo(
        id=KrakenTrades.id,
        display_name=KrakenTrades.display_name,
        kind="trades",
        enabled=True,
        markets=["crypto_24x7"],
        timeframes=[],
        max_range_days={"trades": TRADE_WINDOW_HOURS / 24},
        symbols=sorted(KRAKEN_SYMBOLS),
        terms_url=KrakenTrades.terms_url,
        attribution=KrakenTrades.attribution,
        mode="PUBLIC EXCHANGE DATA",
        note=(
            f"Recent trades in windows of at most {TRADE_WINDOW_HOURS} hours, paged 1,000 at a "
            "time; used for the FROM TRADES heatmap. A window cut short by the request bound is "
            "marked as truncated."
        ),
    )
