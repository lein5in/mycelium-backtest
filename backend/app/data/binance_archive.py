import hashlib
import io
import re
import zipfile
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.data.base import CandleProvider
from app.data.catalog import Window, bars_from_rows, check_symbol
from app.data.errors import BadPayloadError, OutOfRangeError
from app.data.http import FetchBudget, fetch_slot
from app.data.models import DataResult
from app.engine.bars import BarSeries

BASE_URL = "https://data.binance.vision/data/spot"
MAX_FILES = 40
MAX_ZIP_BYTES = 64 * 1024 * 1024
MAX_CSV_BYTES = 256 * 1024 * 1024
CHECKSUM_PATTERN = re.compile(r"^([0-9a-f]{64})\s+\S+\s*$")
MICROSECONDS_FROM = 10**14
SYMBOLS = {"BTC-USDT": "BTCUSDT", "ETH-USDT": "ETHUSDT", "SOL-USDT": "SOLUSDT"}


def archive_files(window: Window, symbol: str, today: date) -> list[tuple[str, str]]:
    interval = window.timeframe
    first = window.start.date()
    last = (window.end - pd.Timedelta(nanoseconds=1)).date()
    files = []
    day = first
    while day <= last:
        month_start = day.replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        month_end = next_month - timedelta(days=1)
        whole_month = day == month_start and month_end <= last and next_month <= today
        if whole_month:
            stamp = f"{day:%Y-%m}"
            files.append(("monthly", f"{symbol}-{interval}-{stamp}.zip"))
            day = next_month
        else:
            files.append(("daily", f"{symbol}-{interval}-{day:%Y-%m-%d}.zip"))
            day += timedelta(days=1)
    return files


def verify_checksum(content: bytes, checksum: bytes, provider: str) -> None:
    match = CHECKSUM_PATTERN.match(checksum.decode("ascii", errors="replace").strip())
    if match is None:
        raise BadPayloadError("Binance archive: the checksum file is malformed.", provider)
    if hashlib.sha256(content).hexdigest() != match.group(1):
        raise BadPayloadError(
            "Binance archive: checksum mismatch; the file was rejected.", provider
        )


def parse_klines(content: bytes, provider: str) -> np.ndarray:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise BadPayloadError("Binance archive: the file is not a valid zip.", provider) from error
    members = [info for info in archive.infolist() if info.filename.endswith(".csv")]
    if len(members) != 1 or members[0].file_size > MAX_CSV_BYTES:
        raise BadPayloadError("Binance archive: unexpected archive contents.", provider)
    with archive.open(members[0]) as handle:
        frame = pd.read_csv(handle, header=None, usecols=range(6), dtype=str)
    values = frame.apply(pd.to_numeric, errors="coerce")
    values = values[values[0].notna()]
    data = values.to_numpy(dtype=np.float64, copy=True)
    if data.size == 0 or not np.isfinite(data).all():
        raise BadPayloadError("Binance archive: the file has invalid rows.", provider)
    data[:, 0] = np.where(data[:, 0] >= MICROSECONDS_FROM, data[:, 0] / 1e6, data[:, 0] / 1e3)
    return data


class BinanceArchive(CandleProvider):
    id = "binance_archive"
    display_name = "Binance public data archive"
    terms_url = "https://github.com/binance/binance-public-data"
    attribution = "Candles: Binance public data archive (data.binance.vision), checksum verified."
    note = (
        "Daily and monthly archive files only, never api.binance.com. Complete past days only; "
        "the archive publishes a day after it ends. Its data terms are not stated."
    )
    timeframes = ("1m", "5m", "15m", "30m", "1h", "4h", "1d")
    symbols = SYMBOLS
    max_requests = 2 * MAX_FILES + 6
    max_seconds = 120.0

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> DataResult:
        native = check_symbol(symbol, self.symbols, self.id)
        window = self.window(start, end, timeframe)
        today = self.now().normalize()
        warnings: tuple[str, ...] = ()
        if window.end > today:
            if window.start >= today:
                raise OutOfRangeError(
                    "The archive only has complete past days; choose an earlier range.", self.id
                )
            window = Window(start=window.start, end=today, timeframe=window.timeframe)
            warnings = (
                "The range was cut at the start of today (UTC): the archive has "
                "complete past days only.",
            )
        files = archive_files(window, native, today.date())
        if len(files) > MAX_FILES:
            raise OutOfRangeError(
                f"This range needs more than {MAX_FILES} archive files; choose a shorter range.",
                self.id,
            )
        with fetch_slot():
            bars = self.fetch_files(native, window, files, self.budget())
        result = self.result(symbol, window, bars)
        return DataResult(
            bars=result.bars, source=result.source, gaps=result.gaps, warnings=warnings
        )

    def fetch_files(
        self, native: str, window: Window, files: list[tuple[str, str]], budget: FetchBudget
    ) -> BarSeries:
        parts = []
        for period, name in files:
            url = f"{BASE_URL}/{period}/klines/{native}/{window.timeframe}/{name}"
            content = self.fetcher.get_bytes(url, budget, MAX_ZIP_BYTES)
            checksum = self.fetcher.get_bytes(f"{url}.CHECKSUM", budget, 1_024)
            verify_checksum(content, checksum, self.id)
            parts.append(parse_klines(content, self.id))
        data = np.concatenate(parts)
        return bars_from_rows(
            data[:, 0],
            {
                "open": data[:, 1],
                "high": data[:, 2],
                "low": data[:, 3],
                "close": data[:, 4],
                "volume": data[:, 5],
            },
            window,
            self.id,
        )
