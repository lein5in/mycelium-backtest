import io

import pandas as pd

from app.data.csv_import import CsvOptions, import_csv
from app.data.samples import fetch_sample
from tests.data.pipeline import run_pipeline

START = pd.Timestamp("2024-01-02", tz="UTC")


def test_sample_set_end_to_end():
    data = fetch_sample("SAMPLE-B", "5m", START, START + pd.Timedelta(days=120))
    outcome = run_pipeline(data, "gap_fade")
    print(f"\n{outcome.summary()}")
    assert outcome.data.source.mode == "SAMPLE DATA"
    assert outcome.report.run.trade_count > 0
    assert outcome.report.run.market == "us_equity"
    assert outcome.grid.mode == "ESTIMATED_FROM_CANDLES"
    assert len(outcome.report.checks) == 6


def test_csv_end_to_end_from_a_generated_file():
    sample = fetch_sample("SAMPLE-A", "5m", START, START + pd.Timedelta(days=90)).bars
    frame = sample.to_frame().tz_convert("America/New_York")
    frame.index = frame.index.tz_localize(None).strftime("%Y-%m-%d %H:%M:%S")
    buffer = io.StringIO()
    frame.rename_axis("Date Time").to_csv(buffer, sep=";", decimal=",")
    content = buffer.getvalue().encode()
    data, report = import_csv(
        content, CsvOptions(market="us_equity", timezone="America/New_York", symbol="SAMPLE-A")
    )
    assert report.delimiter == ";"
    assert report.timeframe == "5m"
    assert data.bars.size == sample.size
    assert (data.bars.ts_ns == sample.ts_ns).all()
    outcome = run_pipeline(data, "orb")
    print(f"\n{outcome.summary()}")
    assert outcome.data.source.mode == "USER CSV"
    assert outcome.report.run.trade_count > 0
    assert outcome.grid.total_volume > 0
