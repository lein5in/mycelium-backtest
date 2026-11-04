import math

import numpy as np
import pandas as pd

from app.data.base import CandleProvider
from app.data.catalog import Window, bars_from_rows
from app.data.errors import BadPayloadError, OutOfRangeError
from app.data.http import FetchBudget
from app.engine.bars import TIMEFRAME_MINUTES, BarSeries

BASE_URL = "https://api.exchange.coinbase.com"
PAGE = 300
SYMBOLS = {
    "BTC-USD": "BTC-USD",
    "ETH-USD": "ETH-USD",
    "SOL-USD": "SOL-USD",
    "LTC-USD": "LTC-USD",
    "BTC-USDT": "BTC-USDT",
    "ETH-USDT": "ETH-USDT",
}
GRANULARITY = {"1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "1d": 86_400}


class CoinbaseCandles(CandleProvider):
    id = "coinbase"
    display_name = "Coinbase Exchange"
    terms_url = "https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles"
    attribution = "Candles: Coinbase Exchange public market data (no API key)."
    note = (
        "Public candles, at most 300 per request, paged. Intervals without trades have no candle "
        "and are reported as gaps."
    )
    timeframes = ("1m", "5m", "15m", "1h", "1d")
    symbols = SYMBOLS
    max_requests = 200

    def pages(self, window: Window) -> int:
        return math.ceil(window.bar_count / PAGE)

    def check_requests(self, window: Window) -> None:
        if self.pages(window) > self.max_requests:
            raise OutOfRangeError(
                f"This range needs more than {self.max_requests} requests; choose a shorter range.",
                self.id,
            )

    def fetch_window(self, native: str, window: Window, budget: FetchBudget) -> BarSeries:
        granularity = GRANULARITY[window.timeframe]
        step = pd.Timedelta(minutes=TIMEFRAME_MINUTES[window.timeframe])
        rows: list[list[float]] = []
        cursor = window.start
        while cursor < window.end:
            page_end = min(cursor + step * PAGE, window.end)
            payload = self.fetcher.get_json(
                f"{BASE_URL}/products/{native}/candles",
                {
                    "granularity": granularity,
                    "start": cursor.isoformat(),
                    "end": (page_end - step).isoformat(),
                },
                budget,
            )
            rows.extend(_rows(payload, self.id))
            cursor = page_end
        if not rows:
            return bars_from_rows(np.empty(0), _columns(np.empty((0, 6))), window, self.id)
        data = np.asarray(rows, dtype=np.float64)
        return bars_from_rows(data[:, 0], _columns(data), window, self.id)


def _columns(data: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "open": data[:, 3],
        "high": data[:, 2],
        "low": data[:, 1],
        "close": data[:, 4],
        "volume": data[:, 5],
    }


def _rows(payload: object, provider: str) -> list[list[float]]:
    if not isinstance(payload, list):
        raise BadPayloadError("Coinbase Exchange: unexpected answer format.", provider)
    rows = []
    for row in payload:
        if (
            not isinstance(row, list)
            or len(row) != 6
            or not all(isinstance(v, int | float) and not isinstance(v, bool) for v in row)
        ):
            raise BadPayloadError("Coinbase Exchange: a candle had an unexpected shape.", provider)
        rows.append([float(v) for v in row])
    return rows
