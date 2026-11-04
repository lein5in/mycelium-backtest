import numpy as np
import pandas as pd

from app.data.models import GAP_EXAMPLES, Gap, GapReport
from app.engine.bars import TIMEFRAME_MINUTES, Timeframe
from app.engine.sessions import (
    NS_PER_MINUTE,
    Crypto24x7Session,
    MarketSession,
    UsEquitySession,
    map_sessions,
    nyse_calendar,
)

CRYPTO_NOTE = "Missing bars are periods without trades on the exchange; no bar is invented."
US_NOTE = "Missing bars are compared with the NYSE calendar; no bar is invented."


def _stamp(ns: int):
    return pd.Timestamp(int(ns), tz="UTC").to_pydatetime()


def _nyse_expected(first_ns: int, last_ns: int, step_ns: int) -> np.ndarray:
    calendar = nyse_calendar()
    first_day = pd.Timestamp(first_ns, tz="UTC").tz_convert("America/New_York").normalize()
    last_day = pd.Timestamp(last_ns, tz="UTC").tz_convert("America/New_York").normalize()
    days = calendar.sessions_in_range(first_day.tz_localize(None), last_day.tz_localize(None))
    opens = calendar.opens.loc[days].dt.as_unit("ns").astype("int64").to_numpy()
    closes = calendar.closes.loc[days].dt.as_unit("ns").astype("int64").to_numpy()
    parts = [np.arange(o, c, step_ns, dtype=np.int64) for o, c in zip(opens, closes, strict=True)]
    expected = np.concatenate(parts) if parts else np.empty(0, dtype=np.int64)
    return expected[(expected >= first_ns) & (expected <= last_ns)]


def _group(missing_positions: np.ndarray, expected: np.ndarray, step_ns: int) -> list[Gap]:
    if missing_positions.size == 0:
        return []
    breaks = np.flatnonzero(np.diff(missing_positions) != 1) + 1
    gaps = []
    for run in np.split(missing_positions, breaks):
        gaps.append(
            Gap(
                start=_stamp(expected[run[0]]),
                end=_stamp(expected[run[-1]] + step_ns),
                missing_bars=int(run.size),
            )
        )
    return gaps


def gap_report(ts_ns: np.ndarray, timeframe: Timeframe, session: MarketSession) -> GapReport:
    note = CRYPTO_NOTE if isinstance(session, Crypto24x7Session) else US_NOTE
    if ts_ns.size < 2:
        return GapReport(missing_bars=0, gap_count=0, gaps=[], note=note)
    step_ns = TIMEFRAME_MINUTES[timeframe] * NS_PER_MINUTE
    first, last = int(ts_ns[0]), int(ts_ns[-1])
    if isinstance(session, UsEquitySession) and timeframe == "1d":
        mapped = map_sessions(session, ts_ns, TIMEFRAME_MINUTES[timeframe])
        ordinals = mapped.ordinal[mapped.ordinal >= 0]
        expected_ordinals = np.arange(ordinals.min(), ordinals.max() + 1)
        missing = np.flatnonzero(~np.isin(expected_ordinals, ordinals))
        labels = nyse_calendar().sessions.as_unit("ns").asi8
        expected = labels[expected_ordinals]
        step_ns = 1_440 * NS_PER_MINUTE
    elif isinstance(session, UsEquitySession):
        expected = _nyse_expected(first, last, step_ns)
        missing = np.flatnonzero(~np.isin(expected, ts_ns))
    else:
        expected = np.arange(first, last + step_ns, step_ns, dtype=np.int64)
        missing = np.flatnonzero(~np.isin(expected, ts_ns))
    gaps = _group(missing, expected, step_ns)
    return GapReport(
        missing_bars=int(missing.size),
        gap_count=len(gaps),
        gaps=gaps[:GAP_EXAMPLES],
        note=note,
    )
