import builtins
import io
import os

import numpy as np
import pandas as pd
import pytest

from app.data import csv_import
from app.data.csv_import import CsvImportError, CsvOptions, import_csv

HEADER = "timestamp,open,high,low,close,volume"


def rows(start: str, count: int, freq: str = "5min", fmt=None, offset=True) -> list[str]:
    index = pd.date_range(start, periods=count, freq=freq, tz="UTC" if offset else None)
    lines = []
    for i, stamp in enumerate(index):
        text = fmt(stamp) if fmt else stamp.isoformat()
        price = 100 + i * 0.1
        lines.append(f"{text},{price},{price + 0.5},{price - 0.5},{price + 0.2},{10 + i}")
    return lines


def csv(*lines: str, header: str = HEADER) -> bytes:
    return ("\n".join([header, *lines]) + "\n").encode()


def problems(error):
    return [(p.code, p.line, p.column) for p in error.value.report.problems]


def test_iso_with_offset_is_imported_and_labelled():
    result, report = import_csv(csv(*rows("2024-01-01", 12)))
    assert result.bars.size == 12
    assert result.bars.timeframe == "5m"
    assert result.source.mode == "USER CSV"
    assert result.source.provider == "user_csv"
    assert "not stored" in result.source.attribution
    assert report.delimiter == ","
    assert report.timestamp_format == "iso_with_offset"
    assert report.mapping == {
        "timestamp": "timestamp",
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
    }
    assert report.problem_count == 0
    assert result.bars.close[1] == pytest.approx(100.3)


def test_semicolon_decimal_comma_bom_and_separate_date_time_columns():
    lines = ["Date;Time;Open;High;Low;Close;Volume"]
    for i, stamp in enumerate(pd.date_range("2024-07-01 09:00", periods=6, freq="1h")):
        p = 50 + i
        lines.append(f"{stamp:%Y-%m-%d};{stamp:%H:%M};{p},5;{p + 1},0;{p - 1},0;{p},7;{i + 1}")
    content = "﻿".encode() + ("\n".join(lines) + "\n").encode()
    result, report = import_csv(content, CsvOptions(timezone="Europe/Paris"))
    assert report.delimiter == ";"
    assert report.mapping["date"] == "Date" and report.mapping["time"] == "Time"
    assert report.timezone == "Europe/Paris"
    assert any("Decimal commas" in w for w in report.warnings)
    assert result.bars.timestamp(0) == pd.Timestamp("2024-07-01 07:00", tz="UTC")
    assert result.bars.open[0] == pytest.approx(50.5)
    assert result.bars.timeframe == "1h"


@pytest.mark.parametrize(
    ("scale", "name"),
    [(1, "epoch_seconds"), (1_000, "epoch_milliseconds"), (1_000_000, "epoch_microseconds")],
)
def test_epoch_timestamps_in_tab_separated_files(scale, name):
    first = int(pd.Timestamp("2024-03-01", tz="UTC").timestamp())
    lines = ["TIME\tOPEN\tHIGH\tLOW\tCLOSE\tVOL"]
    for i in range(10):
        lines.append(f"{(first + 60 * i) * scale}\t10\t11\t9\t10.5\t3")
    result, report = import_csv(("\n".join(lines) + "\n").encode())
    assert report.delimiter == "\t"
    assert report.timestamp_format == name
    assert result.bars.timeframe == "1m"
    assert result.bars.timestamp(0) == pd.Timestamp("2024-03-01", tz="UTC")


def test_local_timestamps_require_a_declared_timezone():
    content = csv(*rows("2024-01-01 09:00", 5, offset=False, fmt=lambda s: f"{s:%Y-%m-%d %H:%M}"))
    with pytest.raises(CsvImportError) as error:
        import_csv(content)
    assert error.value.code == "csv_invalid"
    assert problems(error) == [("timezone_required", None, "timestamp")]
    assert "declare" in error.value.user_message
    result, report = import_csv(content, CsvOptions(timezone="UTC"))
    assert report.timestamp_format == "local_time"
    assert result.bars.size == 5


def test_daylight_saving_fall_back_is_resolved_from_the_row_order():
    stamps = ["2024-11-03 00:00", "2024-11-03 01:00", "2024-11-03 01:00", "2024-11-03 02:00"]
    lines = [f"{s},10,11,9,10,1" for s in stamps]
    result, report = import_csv(csv(*lines), CsvOptions(timezone="America/New_York"))
    assert [result.bars.timestamp(i).hour for i in range(4)] == [4, 5, 6, 7]
    assert any("resolved from the row order" in w for w in report.warnings)


def test_daylight_saving_spring_forward_is_an_error_with_its_line():
    stamps = ["2024-03-10 01:00", "2024-03-10 01:30", "2024-03-10 02:30", "2024-03-10 03:30"]
    lines = [f"{s},10,11,9,10,1" for s in stamps]
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*lines), CsvOptions(timezone="America/New_York"))
    assert problems(error) == [("nonexistent_time", 4, "timestamp")]


def test_cell_problems_are_reported_with_line_and_column():
    lines = rows("2024-01-01", 8)
    lines[2] = lines[2].rsplit(",", 2)[0] + ",oops,10"
    parts = lines[4].split(",")
    parts[2], parts[3] = parts[3], parts[2]
    lines[4] = ",".join(parts)
    lines[6] = lines[6].rsplit(",", 1)[0] + ",-5"
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*lines))
    found = problems(error)
    assert ("not_a_number", 4, "close") in found
    assert ("high_below_low", 6, "high") in found
    assert ("negative_volume", 8, "volume") in found


def test_at_most_fifty_problems_are_listed_with_a_total():
    lines = [line.rsplit(",", 2)[0] + ",x,1" for line in rows("2024-01-01", 80)]
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*lines))
    assert len(error.value.report.problems) == 50
    assert error.value.report.problem_count == 80


def test_duplicates_and_disorder_are_errors_but_newest_first_is_reversed():
    lines = rows("2024-01-01", 6)
    duplicate = [*lines[:3], lines[2], *lines[3:]]
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*duplicate))
    assert ("duplicate_timestamp", 5, "timestamp") in problems(error)
    shuffled = [lines[0], lines[2], lines[1], *lines[3:]]
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*shuffled))
    assert ("not_increasing", 4, "timestamp") in problems(error)
    result, report = import_csv(csv(*lines[::-1]))
    assert np.all(np.diff(result.bars.ts_ns) > 0)
    assert any("newest first" in w for w in report.warnings)


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"", "empty"),
        (b"timestamp,open\x00,high\n", "binary"),
        ("timestamp,open,high,low,close,volume\n2024,\xe9\n".encode("latin-1"), "encoding"),
        (("a" * 5_000 + "\n").encode(), "line_too_long"),
        (
            (",".join(f"c{i}" for i in range(60)) + "\n" + ",".join("1" * 60) + "\n").encode(),
            "too_many_columns",
        ),
        (b"timestamp,open,high,low,close,volume\n", "empty"),
        (b"when,open,high,low,close\n1,2,3,4,5\n", "missing_column"),
    ],
)
def test_hostile_or_malformed_files_are_rejected(content, code):
    with pytest.raises(CsvImportError) as error:
        import_csv(content)
    assert code in [p.code for p in error.value.report.problems]


def test_size_and_row_limits(monkeypatch):
    with pytest.raises(CsvImportError) as error:
        import_csv(b"x" * (csv_import.MAX_BYTES + 1))
    assert problems(error)[0][0] == "too_large"
    monkeypatch.setattr(csv_import, "MAX_ROWS", 10)
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*rows("2024-01-01", 11)))
    assert problems(error)[0][0] == "too_many_rows"


def test_cells_are_never_evaluated():
    lines = rows("2024-01-01", 4)
    lines[1] = lines[1].rsplit(",", 2)[0] + ",=cmd|' /C calc'!A0,__import__('os').system('x')"
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*lines))
    assert ("not_a_number", 3, "close") in problems(error)
    assert ("not_a_number", 3, "volume") in problems(error)


def test_column_override_and_timeframe_warning():
    lines = rows("2024-01-01", 6, freq="15min")
    header = "When,First,Top,Bottom,Last,Qty"
    options = CsvOptions(
        columns={
            "timestamp": "When",
            "open": "First",
            "high": "Top",
            "low": "Bottom",
            "close": "Last",
            "volume": "Qty",
        },
        timeframe="5m",
    )
    result, report = import_csv(csv(*lines, header=header), options)
    assert report.mapping["open"] == "First"
    assert result.bars.timeframe == "5m"
    assert any("differs from the detected 15m" in w for w in report.warnings)


def test_us_equity_bars_outside_sessions_are_listed_and_gaps_reported():
    regular = rows("2024-12-02 14:30", 4)
    after_hours = rows("2024-12-02 21:30", 1)
    with pytest.raises(CsvImportError) as error:
        import_csv(csv(*regular, *after_hours), CsvOptions(market="us_equity"))
    assert ("outside_session", 6, "timestamp") in problems(error)
    gapped = [*regular[:2], *regular[3:]]
    result, report = import_csv(csv(*gapped), CsvOptions(market="us_equity"))
    assert result.gaps.missing_bars == 1
    assert any("missing compared with the market calendar" in w for w in report.warnings)


def test_import_never_creates_a_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    writes = []
    real_open = builtins.open
    real_os_open = os.open

    def guarded_open(file, mode="r", *args, **kwargs):
        if any(flag in mode for flag in "wax+"):
            writes.append(file)
        return real_open(file, mode, *args, **kwargs)

    def guarded_os_open(path, flags, *args, **kwargs):
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
            writes.append(path)
        return real_os_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", guarded_open)
    monkeypatch.setattr(io, "open", guarded_open)
    monkeypatch.setattr(os, "open", guarded_os_open)
    import_csv(csv(*rows("2024-01-01", 50)))
    with pytest.raises(CsvImportError):
        import_csv(csv("2024-01-01,1,2,3"))
    assert writes == []
    assert list(tmp_path.iterdir()) == []
