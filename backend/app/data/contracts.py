import json
from pathlib import Path

import pandas as pd

from app.data.heatmap import GRID_SCHEMA_VERSION, HeatmapGrid, grid_from_candles
from app.data.samples import fetch_sample

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA_PATH = CONTRACTS_DIR / "heatmap_grid.schema.json"
SAMPLE_PATH = CONTRACTS_DIR / "heatmap_grid.sample.json"


def _to_json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def heatmap_grid_json_schema() -> dict[str, object]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://mycelium-backtest/contracts/heatmap_grid.schema.json",
        "title": "HeatmapGrid",
        "x-schema-version": GRID_SCHEMA_VERSION,
        **HeatmapGrid.model_json_schema(),
    }


def sample_grid() -> HeatmapGrid:
    start = pd.Timestamp("2024-12-02 14:30", tz="UTC")
    bars = fetch_sample("SAMPLE-A", "5m", start, start + pd.Timedelta(hours=2)).bars
    return grid_from_candles(bars, rows=16).grid


def schema_text() -> str:
    return _to_json(heatmap_grid_json_schema())


def sample_text() -> str:
    return _to_json(sample_grid().model_dump(mode="json"))


def main() -> None:
    SCHEMA_PATH.write_text(schema_text(), encoding="utf-8", newline="\n")
    SAMPLE_PATH.write_text(sample_text(), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
