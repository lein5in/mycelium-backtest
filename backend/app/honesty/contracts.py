import json
from pathlib import Path

import numpy as np
import pandas as pd

from app.engine import BacktestConfig, run_backtest, validate_bars
from app.engine.models import CostModel, Instrument, SlippageBps
from app.engine.sessions import Crypto24x7Session
from app.honesty.config import HonestyConfig
from app.honesty.model import REPORT_SCHEMA_VERSION, HonestyReport
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.strategies.registry import build_spec, validate_parameters

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA_PATH = CONTRACTS_DIR / "honesty_report.schema.json"
SAMPLE_PATH = CONTRACTS_DIR / "honesty_report.sample.json"
SAMPLE_BARS = 1_500
SAMPLE_SEED = 11


def _to_json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def honesty_report_json_schema() -> dict[str, object]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://mycelium-backtest/contracts/honesty_report.schema.json",
        "title": "HonestyReport",
        "x-schema-version": REPORT_SCHEMA_VERSION,
        **HonestyReport.model_json_schema(),
    }


def sample_report() -> HonestyReport:
    rng = np.random.default_rng(SAMPLE_SEED)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.006, SAMPLE_BARS)))
    open_ = np.r_[100.0, close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.004, SAMPLE_BARS))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.004, SAMPLE_BARS))
    index = pd.date_range("2025-11-20", periods=SAMPLE_BARS, freq="1h", tz="UTC")
    frame = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1_000.0},
        index=index,
    )
    bars = validate_bars(frame, "1h")
    config = BacktestConfig(
        session=Crypto24x7Session(),
        instrument=Instrument(symbol="SAMPLE-USD"),
        costs=CostModel(fee_pct=0.1, slippage=SlippageBps(value=2)),
    )
    params = validate_parameters(
        "donchian_breakout", {"entry_lookback": 12, "exit_lookback": 6}, "crypto_24x7"
    )
    spec = build_spec("donchian_breakout", params, "crypto_24x7")
    output = run_backtest(bars, spec, config)
    inputs = HonestyInput(
        bars=bars,
        spec=spec,
        config=config,
        output=output,
        strategy_id="donchian_breakout",
        parameters=params,
        sweep=SweepRequest("donchian_breakout", params, "crypto_24x7"),
    )
    return build_report(inputs, HonestyConfig(random_draws=200), clock=lambda: 0.0)


def schema_text() -> str:
    return _to_json(honesty_report_json_schema())


def sample_text() -> str:
    return _to_json(sample_report().model_dump(mode="json"))


def main() -> None:
    SCHEMA_PATH.write_text(schema_text(), encoding="utf-8", newline="\n")
    SAMPLE_PATH.write_text(sample_text(), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
