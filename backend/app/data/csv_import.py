import io
import re
from collections import Counter
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.data.errors import DataError, ErrorCode
from app.data.gaps import gap_report
from app.data.models import DataResult, GapReport, ProviderInfo, SourceDescriptor
from app.engine.bars import TIMEFRAME_MINUTES, BarsValidationError, Timeframe, validate_bars
from app.engine.sessions import (
    NS_PER_MINUTE,
    Crypto24x7Session,
    MarketKind,
    MarketSession,
    SessionError,
    UsEquitySession,
    map_sessions,
)

PROVIDER = "user_csv"
MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 500_000
MAX_COLUMNS = 50
MAX_LINE_CHARS = 4_096
MAX_LISTED = 50
DELIMITERS = (",", ";", "\t")
ATTRIBUTION = "Your own CSV file, processed in memory and not stored."

Role = Literal["timestamp", "date", "time", "open", "high", "low", "close", "volume"]
PRICE_ROLES = ("open", "high", "low", "close", "volume")
ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": (
        "timestamp",
        "datetime",
        "date_time",
        "date time",
        "time_stamp",
        "open_time",
        "open time",
        "ts",
        "unix",
        "gmt time",
        "local time",
    ),
    "date": ("date", "day"),
    "time": ("time",),
    "open": ("open", "o", "open_price", "open price"),
    "high": ("high", "h", "high_price", "high price"),
    "low": ("low", "l", "low_price", "low price"),
    "close": ("close", "c", "close_price", "close price", "last"),
    "volume": ("volume", "vol", "v", "volume_base", "base_volume"),
}
OFFSET = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$", re.IGNORECASE)
EPOCH = re.compile(r"^\d{9,17}(\.\d+)?$")
DECIMAL_COMMA = re.compile(r"^-?\d+,\d+$")


class CsvOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    market: MarketKind = "crypto_24x7"
    timezone: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    columns: dict[Role, Annotated[str, Field(min_length=1, max_length=64)]] | None = None
    timeframe: Timeframe | None = None
    delimiter: Literal[",", ";", "\t"] | None = None
    symbol: Annotated[str, Field(pattern=r"^[A-Za-z0-9._-]{1,32}$")] = "CSV"
    anchor: Annotated[str, Field(pattern=r"^\d{2}:\d{2}$")] = "00:00"

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"unknown timezone {value!r}") from error
        return value


class CsvProblem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    line: int | None
    column: str | None
    code: str
    message: str


class CsvReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rows: int
    columns: list[str]
    delimiter: str | None
    mapping: dict[str, str]
    timestamp_format: str | None
    timezone: str | None
    timeframe: Timeframe | None
    problems: list[CsvProblem]
    problem_count: int
    warnings: list[str]
    gaps: GapReport | None
    rules: list[str]


class CsvImportError(DataError):
    code: ErrorCode = "csv_invalid"

    def __init__(self, message: str, report: CsvReport) -> None:
        super().__init__(message, PROVIDER)
        self.report = report


RULES = [
    "Timestamps are bar open times.",
    "Numbers without a time zone offset are read as epoch time: seconds, milliseconds or "
    "microseconds, chosen by size.",
    "Text timestamps without an offset are read in the time zone you declare; without a "
    "declared time zone the import stops and asks for one.",
    "A repeated local hour when clocks go back is resolved from the order of the rows (first "
    "pass daylight time, second pass standard time); if the order does not tell, the first "
    "occurrence is used and a warning says so.",
    "A local time that does not exist because clocks moved forward is an error.",
    "A file sorted newest first is reversed, with a warning; any other disorder is an error.",
]


class _Collector:
    def __init__(self) -> None:
        self.problems: list[CsvProblem] = []
        self.count = 0
        self.warnings: list[str] = []

    def add(self, code: str, message: str, line: int | None = None, column: str | None = None):
        self.count += 1
        if len(self.problems) < MAX_LISTED:
            self.problems.append(CsvProblem(line=line, column=column, code=code, message=message))

    def rows(self, code: str, message: str, positions: np.ndarray, column: str | None = None):
        for position in positions.tolist():
            self.add(code, message, int(position) + 2, column)


class _State:
    def __init__(self) -> None:
        self.columns: list[str] = []
        self.rows = 0
        self.delimiter: str | None = None
        self.mapping: dict[str, str] = {}
        self.timestamp_format: str | None = None
        self.timezone: str | None = None
        self.timeframe: Timeframe | None = None
        self.gaps: GapReport | None = None


def _report(state: _State, collector: _Collector) -> CsvReport:
    return CsvReport(
        rows=state.rows,
        columns=state.columns,
        delimiter=state.delimiter,
        mapping=state.mapping,
        timestamp_format=state.timestamp_format,
        timezone=state.timezone,
        timeframe=state.timeframe,
        problems=collector.problems,
        problem_count=collector.count,
        warnings=collector.warnings,
        gaps=state.gaps,
        rules=RULES,
    )


def _stop(state: _State, collector: _Collector, message: str) -> CsvImportError:
    return CsvImportError(message, _report(state, collector))


def _decode(content: bytes, state: _State, collector: _Collector) -> str:
    if not isinstance(content, bytes | bytearray):
        collector.add("input", "The upload must be a file.")
        raise _stop(state, collector, "The upload must be a file.")
    if len(content) == 0:
        collector.add("empty", "The file is empty.")
        raise _stop(state, collector, "The file is empty.")
    if len(content) > MAX_BYTES:
        collector.add("too_large", f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB.")
        raise _stop(state, collector, "The file is too large.")
    if b"\x00" in content:
        collector.add("binary", "The file contains binary data; a text CSV is expected.")
        raise _stop(state, collector, "The file is not a text CSV.")
    try:
        text = bytes(content).decode("utf-8-sig")
    except UnicodeDecodeError as error:
        collector.add("encoding", f"The file is not UTF-8 (byte {error.start}).")
        raise _stop(state, collector, "The file must be UTF-8 text.") from error
    longest = max((len(line) for line in text.splitlines()), default=0)
    if longest > MAX_LINE_CHARS:
        collector.add("line_too_long", f"A line is longer than {MAX_LINE_CHARS:,} characters.")
        raise _stop(state, collector, "The file has an absurdly long line.")
    return text


def _delimiter(text: str, options: CsvOptions) -> str:
    if options.delimiter is not None:
        return options.delimiter
    sample = [line for line in text.splitlines()[:20] if line.strip()]
    best, best_score = ",", -1
    for candidate in DELIMITERS:
        counts = [line.count(candidate) for line in sample]
        if not counts or counts[0] == 0:
            continue
        score = sum(1 for count in counts if count == counts[0]) * 1_000 + counts[0]
        if score > best_score:
            best, best_score = candidate, score
    return best


def _mapping(headers: list[str], options: CsvOptions, collector: _Collector) -> dict[str, str]:
    lowered = {header.strip().lower(): header for header in headers}
    mapping: dict[str, str] = {}
    override = options.columns or {}
    for role, header in override.items():
        if header not in headers:
            collector.add("mapping", f"Column {header!r} given for {role} is not in the file.")
        else:
            mapping[role] = header
    for role, names in ALIASES.items():
        if role in mapping:
            continue
        for name in names:
            if name in lowered and lowered[name] not in mapping.values():
                mapping[role] = lowered[name]
                break
    if "timestamp" not in mapping and ("date" in mapping) != ("time" in mapping):
        mapping["timestamp"] = mapping.pop("date", None) or mapping.pop("time")
    if "timestamp" in mapping:
        mapping.pop("date", None)
        mapping.pop("time", None)
    missing = [role for role in PRICE_ROLES if role not in mapping]
    if "timestamp" not in mapping and not ("date" in mapping and "time" in mapping):
        missing.insert(0, "timestamp")
    for role in missing:
        collector.add("missing_column", f"No column found for {role}; map it explicitly.")
    return mapping


def _numbers(
    frame: pd.DataFrame, mapping: dict[str, str], state: _State, collector: _Collector
) -> dict[str, np.ndarray]:
    values: dict[str, np.ndarray] = {}
    converted = False
    for role in PRICE_ROLES:
        header = mapping[role]
        raw = frame[header].str.strip()
        parsed = pd.to_numeric(raw, errors="coerce")
        bad = parsed.isna().to_numpy().copy()
        if bad.any() and state.delimiter != "," and raw[bad].str.fullmatch(DECIMAL_COMMA).all():
            parsed = pd.to_numeric(raw.str.replace(",", ".", regex=False), errors="coerce")
            bad = parsed.isna().to_numpy().copy()
            converted = True
        column = parsed.to_numpy(dtype=np.float64)
        bad |= ~np.isfinite(column)
        collector.rows(
            "not_a_number", f"{role} is empty or not a number", np.flatnonzero(bad), header
        )
        values[role] = column
    if converted:
        collector.warnings.append("Decimal commas were read as decimal points.")
    o, h, low, c, v = (values[role] for role in PRICE_ROLES)
    with np.errstate(invalid="ignore"):
        non_positive = (o <= 0) | (h <= 0) | (low <= 0) | (c <= 0)
        checks = [
            ("non_positive_price", "prices must be positive", non_positive, None),
            ("high_below_low", "high is below low", h < low, mapping["high"]),
            (
                "open_outside_range",
                "open is outside the range",
                (o > h) | (o < low),
                mapping["open"],
            ),
            (
                "close_outside_range",
                "close is outside the range",
                (c > h) | (c < low),
                mapping["close"],
            ),
            ("negative_volume", "volume is negative", v < 0, mapping["volume"]),
        ]
    for code, message, mask, header in checks:
        collector.rows(code, message, np.flatnonzero(mask), header)
    zero = int((v == 0).sum())
    if zero:
        collector.warnings.append(f"{zero:,} rows have zero volume.")
    return values


def _localize(
    naive: pd.Series, timezone: str, header: str, collector: _Collector
) -> pd.Series | None:
    index = pd.DatetimeIndex(naive)
    strict = index.tz_localize(timezone, ambiguous="NaT", nonexistent="NaT")
    probe = index.tz_localize(timezone, ambiguous=True, nonexistent="NaT")
    nonexistent = np.asarray(probe.isna())
    ambiguous = np.asarray(strict.isna()) & ~nonexistent
    if nonexistent.any():
        collector.rows(
            "nonexistent_time",
            f"this local time does not exist in {timezone} (clocks moved forward)",
            np.flatnonzero(nonexistent),
            header,
        )
        return None
    localized = probe
    if ambiguous.any():
        count = int(ambiguous.sum())
        try:
            localized = index.tz_localize(timezone, ambiguous="infer")
        except ValueError:
            collector.warnings.append(
                f"{count:,} repeated local times could not be resolved from the row order; "
                "the first occurrence (daylight time) was used."
            )
        else:
            collector.warnings.append(
                f"{count:,} repeated local times (clocks going back) were resolved from the "
                "row order."
            )
    return pd.Series(localized.tz_convert("UTC"))


def _timestamps(
    frame: pd.DataFrame,
    mapping: dict[str, str],
    options: CsvOptions,
    state: _State,
    collector: _Collector,
) -> np.ndarray | None:
    if "timestamp" in mapping:
        header = mapping["timestamp"]
        raw = frame[header].str.strip()
    else:
        header = f"{mapping['date']} + {mapping['time']}"
        raw = frame[mapping["date"]].str.strip() + " " + frame[mapping["time"]].str.strip()
    if raw.str.fullmatch(EPOCH).all():
        numbers = pd.to_numeric(raw).to_numpy(dtype=np.float64)
        median = float(np.median(numbers))
        if median < 1e11:
            state.timestamp_format, scale = "epoch_seconds", 1e9
        elif median < 1e14:
            state.timestamp_format, scale = "epoch_milliseconds", 1e6
        else:
            state.timestamp_format, scale = "epoch_microseconds", 1e3
        state.timezone = "UTC"
        return np.round(numbers * scale).astype(np.int64)
    has_offset = raw.str.contains(OFFSET)
    if has_offset.all():
        parsed = pd.to_datetime(raw, utc=True, errors="coerce", format="ISO8601")
        state.timestamp_format = "iso_with_offset"
        state.timezone = "UTC"
    elif not has_offset.any():
        if options.timezone is None:
            collector.add(
                "timezone_required",
                "Timestamps have no UTC offset; declare their time zone (for example UTC or "
                "America/New_York). The import does not guess.",
                column=header,
            )
            return None
        naive = pd.to_datetime(raw, errors="coerce", format="ISO8601")
        unparsed = naive.isna().to_numpy()
        collector.rows(
            "bad_timestamp", "the timestamp could not be read", np.flatnonzero(unparsed), header
        )
        if unparsed.any():
            return None
        parsed = _localize(naive, options.timezone, header, collector)
        if parsed is None:
            return None
        state.timestamp_format = "local_time"
        state.timezone = options.timezone
    else:
        collector.rows(
            "mixed_offsets",
            "some timestamps have a UTC offset and others do not",
            np.flatnonzero(~has_offset.to_numpy()),
            header,
        )
        return None
    unparsed = parsed.isna().to_numpy()
    collector.rows(
        "bad_timestamp", "the timestamp could not be read", np.flatnonzero(unparsed), header
    )
    if unparsed.any():
        return None
    return pd.DatetimeIndex(parsed).as_unit("ns").asi8.copy()


def _order(ts_ns: np.ndarray, header: str, collector: _Collector) -> np.ndarray:
    steps = np.diff(ts_ns)
    if ts_ns.size > 1 and (steps < 0).all():
        collector.warnings.append("The file was sorted newest first; it was reversed.")
        return np.arange(ts_ns.size)[::-1]
    collector.rows(
        "duplicate_timestamp", "duplicate timestamp", np.flatnonzero(steps == 0) + 1, header
    )
    collector.rows(
        "not_increasing", "timestamp goes backwards", np.flatnonzero(steps < 0) + 1, header
    )
    return np.arange(ts_ns.size)


def detect_timeframe(ts_ns: np.ndarray) -> Timeframe | None:
    steps = np.diff(ts_ns)
    steps = steps[steps > 0]
    if steps.size == 0:
        return None
    step, _ = Counter((steps // NS_PER_MINUTE).tolist()).most_common(1)[0]
    for name, minutes in TIMEFRAME_MINUTES.items():
        if step == minutes:
            return name
    return None


def session_for(options: CsvOptions) -> MarketSession:
    if options.market == "us_equity":
        return UsEquitySession()
    return Crypto24x7Session(anchor=options.anchor, timezone="UTC")


def import_csv(content: bytes, options: CsvOptions | None = None) -> tuple[DataResult, CsvReport]:
    options = options or CsvOptions()
    state = _State()
    collector = _Collector()
    text = _decode(content, state, collector)
    state.delimiter = _delimiter(text, options)
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            sep=state.delimiter,
            dtype=str,
            keep_default_na=False,
            na_filter=False,
            engine="c",
            nrows=MAX_ROWS + 1,
            skipinitialspace=True,
        )
    except (pd.errors.ParserError, ValueError) as error:
        collector.add("parse", f"The CSV could not be read: {str(error)[:120]}")
        raise _stop(state, collector, "The CSV could not be read.") from error
    state.columns = [str(column) for column in frame.columns]
    state.rows = len(frame)
    if len(frame.columns) > MAX_COLUMNS:
        collector.add("too_many_columns", f"More than {MAX_COLUMNS} columns.")
        raise _stop(state, collector, "The file has too many columns.")
    if len(frame) > MAX_ROWS:
        collector.add("too_many_rows", f"More than {MAX_ROWS:,} rows.")
        raise _stop(state, collector, "The file has too many rows.")
    if len(frame) == 0:
        collector.add("empty", "The file has a header but no rows.")
        raise _stop(state, collector, "The file has no rows.")
    mapping = _mapping(state.columns, options, collector)
    state.mapping = mapping
    if collector.count:
        raise _stop(state, collector, "Required columns are missing.")
    values = _numbers(frame, mapping, state, collector)
    ts_ns = _timestamps(frame, mapping, options, state, collector)
    if ts_ns is None:
        raise _stop(state, collector, collector.problems[-1].message)
    header = mapping.get("timestamp", "timestamp")
    order = _order(ts_ns, header, collector)
    ts_ns = ts_ns[order]
    values = {role: column[order] for role, column in values.items()}
    if collector.count:
        raise _stop(state, collector, f"The file has {collector.count:,} problems.")
    detected = detect_timeframe(ts_ns)
    timeframe = options.timeframe or detected
    state.timeframe = timeframe
    if timeframe is None:
        collector.add(
            "timeframe",
            "Could not detect a supported bar interval (1m, 5m, 15m, 30m, 1h, 4h or 1d).",
        )
        raise _stop(state, collector, "Unsupported bar interval.")
    if options.timeframe is not None and detected not in (None, options.timeframe):
        collector.warnings.append(
            f"The declared timeframe {options.timeframe} differs from the detected {detected}."
        )
    session = session_for(options)
    try:
        sessions = map_sessions(session, ts_ns, TIMEFRAME_MINUTES[timeframe])
    except SessionError as error:
        collector.add("calendar", str(error))
        raise _stop(state, collector, "The dates are outside the supported calendar.") from error
    outside = np.flatnonzero(sessions.outside)
    if outside.size:
        collector.rows(
            "outside_session",
            "this bar is outside the market's regular sessions",
            order[outside],
            header,
        )
        raise _stop(state, collector, "Some bars fall outside the market's sessions.")
    index = pd.DatetimeIndex(ts_ns.astype("datetime64[ns]")).tz_localize("UTC")
    bar_frame = pd.DataFrame(values, index=index.rename("timestamp"))
    try:
        bars = validate_bars(bar_frame, timeframe)
    except BarsValidationError as error:
        for problem in error.problems:
            collector.add(problem.code, problem.message)
        raise _stop(state, collector, "The bars failed validation.") from error
    state.gaps = gap_report(bars.ts_ns, timeframe, session)
    if state.gaps.missing_bars:
        collector.warnings.append(
            f"{state.gaps.missing_bars:,} bars are missing compared with the market calendar."
        )
    report = _report(state, collector)
    result = DataResult(
        bars=bars,
        source=SourceDescriptor(
            provider=PROVIDER,
            display_name="Your CSV file",
            terms_url=None,
            attribution=ATTRIBUTION,
            mode="USER CSV",
            symbol=options.symbol,
            market=options.market,
            timeframe=timeframe,
            start=bars.timestamp(0).to_pydatetime(),
            end=bars.timestamp(bars.size - 1).to_pydatetime(),
        ),
        gaps=state.gaps,
        warnings=tuple(collector.warnings),
    )
    return result, report


def info() -> ProviderInfo:
    return ProviderInfo(
        id=PROVIDER,
        display_name="CSV import",
        kind="csv",
        enabled=True,
        markets=["us_equity", "crypto_24x7"],
        timeframes=list(TIMEFRAME_MINUTES),
        max_range_days={},
        symbols=[],
        terms_url=None,
        attribution=ATTRIBUTION,
        mode="USER CSV",
        note=(
            f"Up to {MAX_BYTES // (1024 * 1024)} MB and {MAX_ROWS:,} rows, UTF-8, comma, "
            "semicolon or tab. Processed in memory; never written to disk, logged or cached."
        ),
    )
