import json

import numpy as np
import pandas as pd
import pytest
from jsonschema import Draft202012Validator

from app.data.contracts import SAMPLE_PATH, SCHEMA_PATH, sample_text, schema_text
from app.data.heatmap import (
    MAX_COLUMNS,
    MAX_ROWS,
    grid_from_candles,
    grid_from_trades,
    time_buckets,
)
from app.data.samples import fetch_sample
from tests.engine.factories import bars

START = pd.Timestamp("2024-01-01", tz="UTC")


def cell(grid, values, column, row):
    return values[column * grid.rows + row]


def test_single_candle_is_spread_with_body_weight_two():
    series = bars([(10, 13, 9, 12)], volume=120.0)
    build = grid_from_candles(series, rows=4)
    grid = build.grid
    assert (grid.columns, grid.rows) == (1, 4)
    assert grid.lowest_price == 9.0
    assert grid.price_bucket == 1.0
    np.testing.assert_allclose(build.volume[0], [20.0, 40.0, 40.0, 20.0])
    np.testing.assert_allclose(build.buy_volume[0], np.array([20.0, 40.0, 40.0, 20.0]) * 0.75)
    assert grid.mode == "ESTIMATED_FROM_CANDLES"
    assert grid.method.label == "ESTIMATED FROM CANDLES"
    assert "density of 2" in grid.method.volume_rule
    assert grid.poc_row == 1
    assert grid.poc_price == 10.5
    assert grid.total_volume == pytest.approx(120.0)
    assert cell(grid, grid.buy_ratio, 0, 2) == pytest.approx(0.75)


def test_cells_align_with_times_prices_and_gaps():
    rows = [(10, 11, 10, 11), (11, 12, 11, 12), (12, 14, 12, 13), (10, 10.5, 10, 10.5)]
    series = bars(rows, timeframe="1h")
    gapped = series.replace(
        ts_ns=series.ts_ns + np.array([0, 0, 3_600, 3_600], dtype=np.int64) * 10**9
    )
    build = grid_from_candles(gapped, rows=4)
    grid = build.grid
    assert grid.columns == 5
    assert grid.time_bucket_seconds == 3_600
    assert grid.first_time == int(START.timestamp())
    assert build.volume[2].sum() == 0.0
    assert build.volume[0, 0] == pytest.approx(1_000.0)
    assert build.volume[1, 1] == pytest.approx(1_000.0)
    np.testing.assert_allclose(build.volume[3], [0, 0, 2_000 / 3, 1_000 / 3])
    assert build.volume[4, 0] == pytest.approx(1_000.0)
    assert all(cell(grid, grid.intensity, 2, r) == 0.0 for r in range(4))


def test_flat_candle_puts_its_volume_in_one_row():
    series = bars([(10, 14, 10, 14), (12, 12, 12, 12)], volume=50.0)
    build = grid_from_candles(series, rows=4)
    np.testing.assert_allclose(build.volume[1], [0, 0, 50.0, 0])
    assert cell(build.grid, build.grid.buy_ratio, 1, 2) == 0.5


def test_volume_is_conserved_on_sample_data():
    result = fetch_sample("SAMPLE-B", "5m", START, START + pd.Timedelta(days=40))
    build = grid_from_candles(result.bars, rows=150)
    assert build.volume.sum() == pytest.approx(result.bars.volume.sum(), rel=1e-12)
    grid = build.grid
    assert sum(grid.profile_buy) + sum(grid.profile_sell) == pytest.approx(grid.total_volume)
    totals = np.array(grid.profile_buy) + np.array(grid.profile_sell)
    assert grid.poc_row == int(np.argmax(totals))
    intensity = np.array(grid.intensity)
    assert intensity.min() == 0.0 and intensity.max() == 1.0
    assert ((intensity == 0) == (build.volume.reshape(-1) == 0)).all()


def test_bounds_and_bucket_choice():
    assert time_buckets(1_500, 300) == (900, 500)
    assert time_buckets(600, 60) == (60, 600)
    assert time_buckets(601, 60) == (120, 301)
    long = fetch_sample("SAMPLE-A", "5m", START, START + pd.Timedelta(days=60)).bars
    build = grid_from_candles(long, rows=999)
    assert build.grid.columns <= MAX_COLUMNS
    assert build.grid.rows == MAX_ROWS
    assert build.grid.time_bucket_seconds % 300 == 0
    assert len(build.grid.intensity) == build.grid.columns * build.grid.rows
    assert build.volume.sum() == pytest.approx(long.volume.sum(), rel=1e-12)


def test_trades_grid_is_from_trades_with_observed_buy_share():
    t0 = int(START.timestamp()) * 10**9
    time_ns = np.array([t0, t0 + 30 * 10**9, t0 + 61 * 10**9, t0 + 130 * 10**9], dtype=np.int64)
    price = np.array([100.0, 101.9, 103.0, 104.0])
    size = np.array([1.0, 2.0, 3.0, 4.0])
    buyer = np.array([True, False, True, True])
    build = grid_from_trades(time_ns, price, size, buyer, bucket_seconds=60, rows=2)
    grid = build.grid
    assert grid.mode == "FROM_TRADES"
    assert grid.method.label == "FROM TRADES"
    assert (grid.columns, grid.rows, grid.price_bucket) == (3, 2, 2.0)
    np.testing.assert_allclose(build.volume, [[3.0, 0.0], [0.0, 3.0], [0.0, 4.0]])
    assert cell(grid, grid.buy_ratio, 0, 0) == pytest.approx(1 / 3)
    assert cell(grid, grid.buy_ratio, 1, 1) == 1.0
    assert build.volume.sum() == size.sum()
    assert grid.poc_row == 1


def test_candles_can_never_be_labelled_from_trades():
    series = bars([(10, 13, 9, 12)] * 3)
    assert grid_from_candles(series).grid.mode == "ESTIMATED_FROM_CANDLES"
    with pytest.raises(ValueError):
        grid_from_trades(*(np.empty(0) for _ in range(4)))


def test_committed_schema_and_sample_match_and_validate():
    assert SCHEMA_PATH.read_text(encoding="utf-8") == schema_text()
    assert SAMPLE_PATH.read_text(encoding="utf-8") == sample_text()
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(sample)
    sample["mode"] = "FROM TRADES"
    assert not Draft202012Validator(schema).is_valid(sample)


def test_frontend_fields_are_all_present():
    frontend = {
        "mode",
        "time_bucket_seconds",
        "price_bucket",
        "columns",
        "rows",
        "first_time",
        "lowest_price",
        "intensity",
        "buy_ratio",
    }
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    assert frontend <= set(sample)
    assert sample["mode"] in ("FROM_TRADES", "ESTIMATED_FROM_CANDLES")
