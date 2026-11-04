from datetime import datetime

import numpy as np
import pandas as pd

from app.data.base import CandleProvider, Now, utc_now
from app.data.catalog import Window, bars_from_rows, check_symbol, check_window
from app.data.errors import BadPayloadError, NotFoundError
from app.data.http import FetchBudget, HttpFetcher, fetch_slot
from app.data.models import SourceDescriptor, TradesResult
from app.engine.bars import TIMEFRAME_MINUTES, BarSeries

BASE_URL = "https://api.kraken.com/0/public"
CANDLE_LIMIT = 720
TRADE_PAGE = 1_000
TRADE_WINDOW_HOURS = 6
TERMS_URL = "https://docs.kraken.com/api/docs/rest-api/get-ohlc-data"
SYMBOLS = {
    "BTC-USD": "XBTUSD",
    "ETH-USD": "ETHUSD",
    "SOL-USD": "SOLUSD",
    "LTC-USD": "LTCUSD",
    "BTC-USDT": "XBTUSDT",
    "ETH-USDT": "ETHUSDT",
}
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d")


def _history_days() -> dict[str, float]:
    return {tf: (CANDLE_LIMIT - 1) * TIMEFRAME_MINUTES[tf] / 1_440 for tf in TIMEFRAMES}


def _result(payload: object, provider: str) -> tuple[list, object]:
    if not isinstance(payload, dict) or not isinstance(payload.get("error"), list):
        raise BadPayloadError("Kraken: unexpected answer format.", provider)
    errors = [str(e) for e in payload["error"]]
    if errors:
        if any("Unknown asset pair" in e for e in errors):
            raise NotFoundError("Kraken: unknown pair.", provider)
        raise BadPayloadError(f"Kraken: {errors[0][:120]}", provider)
    result = payload.get("result")
    if not isinstance(result, dict):
        raise BadPayloadError("Kraken: unexpected answer format.", provider)
    series = [value for key, value in result.items() if key != "last"]
    if len(series) != 1 or not isinstance(series[0], list):
        raise BadPayloadError("Kraken: unexpected answer format.", provider)
    return series[0], result.get("last")


def _numbers(row: object, width: int, provider: str) -> list[float]:
    if not isinstance(row, list) or len(row) < width:
        raise BadPayloadError("Kraken: a row had an unexpected shape.", provider)
    try:
        return [float(value) for value in row[:width]]
    except (TypeError, ValueError) as error:
        raise BadPayloadError("Kraken: a row had a non-numeric value.", provider) from error


class KrakenCandles(CandleProvider):
    id = "kraken"
    display_name = "Kraken"
    terms_url = TERMS_URL
    attribution = "Candles: Kraken public market data (no API key)."
    note = (
        "Kraken returns only its latest 720 candles per interval, so 1-minute history reaches "
        "back about 12 hours and daily history about two years."
    )
    timeframes = TIMEFRAMES
    symbols = SYMBOLS
    history_days = _history_days()
    max_requests = 4

    def fetch_window(self, native: str, window: Window, budget: FetchBudget) -> BarSeries:
        payload = self.fetcher.get_json(
            f"{BASE_URL}/OHLC",
            {
                "pair": native,
                "interval": TIMEFRAME_MINUTES[window.timeframe],
                "since": int(window.start.timestamp()) - 1,
            },
            budget,
        )
        rows, _ = _result(payload, self.id)
        data = np.array([_numbers(row, 7, self.id) for row in rows], dtype=np.float64)
        if data.size == 0:
            data = np.empty((0, 7))
        interval = TIMEFRAME_MINUTES[window.timeframe] * 60
        committed = data[:, 0] + interval <= self.now().timestamp()
        data = data[committed]
        return bars_from_rows(
            data[:, 0],
            {
                "open": data[:, 1],
                "high": data[:, 2],
                "low": data[:, 3],
                "close": data[:, 4],
                "volume": data[:, 6],
            },
            window,
            self.id,
        )


class KrakenTrades:
    id = "kraken_trades"
    display_name = "Kraken trades"
    terms_url = "https://docs.kraken.com/api/docs/rest-api/get-recent-trades"
    attribution = "Trades: Kraken public market data (no API key)."
    max_requests = 60
    max_seconds = 90.0

    def __init__(self, fetcher: HttpFetcher, now: Now = utc_now) -> None:
        self.fetcher = fetcher
        self.now = now

    def fetch(self, symbol: str, start: datetime, end: datetime) -> TradesResult:
        native = check_symbol(symbol, SYMBOLS, self.id)
        window = check_window(
            start,
            end,
            "1m",
            ("1m",),
            self.id,
            self.now(),
            {"1m": TRADE_WINDOW_HOURS / 24},
        )
        budget = FetchBudget(max_requests=self.max_requests, max_seconds=self.max_seconds)
        end_s = window.end.timestamp()
        since: str = str(int(window.start.timestamp()))
        rows: list[list[float]] = []
        truncated = False
        with fetch_slot():
            while True:
                if budget.requests >= self.max_requests or budget.remaining_seconds() <= 1:
                    truncated = True
                    break
                payload = self.fetcher.get_json(
                    f"{BASE_URL}/Trades",
                    {"pair": native, "since": since, "count": TRADE_PAGE},
                    budget,
                )
                page, last = _result(payload, self.id)
                for row in page:
                    if not isinstance(row, list) or len(row) < 4 or row[3] not in ("b", "s"):
                        raise BadPayloadError("Kraken: a trade had an unexpected shape.", self.id)
                    price, volume, time_s = _numbers(row, 3, self.id)
                    rows.append([time_s, price, volume, 1.0 if row[3] == "b" else 0.0])
                if not page or not isinstance(last, str | int) or str(last) == since:
                    break
                since = str(last)
                if rows and rows[-1][0] >= end_s:
                    break
        data = np.asarray(rows, dtype=np.float64).reshape(-1, 4)
        start_s = window.start.timestamp()
        keep = (data[:, 0] >= start_s) & (data[:, 0] < end_s)
        data = data[keep]
        if not np.all(np.isfinite(data)) or (data[:, 1:3] < 0).any():
            raise BadPayloadError("Kraken: a trade had an invalid price or volume.", self.id)
        covered = data[-1, 0] if truncated and data.size else end_s
        return TradesResult(
            time_ns=(data[:, 0] * 1e9).astype(np.int64),
            price=data[:, 1],
            volume=data[:, 2],
            buy=data[:, 3].astype(bool),
            source=SourceDescriptor(
                provider=self.id,
                display_name=self.display_name,
                terms_url=self.terms_url,
                attribution=self.attribution,
                mode="PUBLIC EXCHANGE DATA",
                symbol=symbol,
                market="crypto_24x7",
                start=window.start.to_pydatetime(),
                end=window.end.to_pydatetime(),
            ),
            covered_until=pd.Timestamp(covered, unit="s", tz="UTC").to_pydatetime(),
            truncated=truncated,
        )
