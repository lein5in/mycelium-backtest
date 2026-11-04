import os
import time

import pytest

from app.engine import BacktestConfig, run_backtest
from app.engine.models import CostModel, SlippageBps
from app.engine.sessions import Crypto24x7Session
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.strategies.registry import build_spec, validate_parameters
from tests.strategies.helpers import random_crypto

BAR_COUNT = 100_000
BUDGET_SECONDS = 120.0

pytestmark = pytest.mark.skipif(
    os.environ.get("MYCELIUM_PERF") != "1",
    reason="performance measurement; run with MYCELIUM_PERF=1",
)


def test_full_report_runtime():
    bars = random_crypto(BAR_COUNT, 42, timeframe="5m")
    config = BacktestConfig(
        session=Crypto24x7Session(), costs=CostModel(fee_pct=0.05, slippage=SlippageBps(value=2))
    )
    values = {"entry_lookback": 400, "exit_lookback": 200, "stop_atr": 4.0}
    params = validate_parameters("donchian_breakout", values, "crypto_24x7")
    spec = build_spec("donchian_breakout", params, "crypto_24x7")
    output = run_backtest(bars, spec, config)
    inputs = HonestyInput(
        bars,
        spec,
        config,
        output,
        "donchian_breakout",
        params,
        SweepRequest("donchian_breakout", params, "crypto_24x7"),
    )
    started = time.perf_counter()
    report = build_report(inputs)
    elapsed = time.perf_counter() - started
    print(
        f"\n{BAR_COUNT:,} bars, {report.run.trade_count} trades, "
        f"{report.random_entries.draws} draws, {report.sweep.completed} sweep cells: "
        f"{elapsed:.2f} s (sweep {report.sweep.elapsed_seconds:.2f} s)"
    )
    assert report.sweep.completed == 25
    assert elapsed < BUDGET_SECONDS
