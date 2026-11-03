import os
import time

import numpy as np
import pandas as pd
import pytest

from app.engine import BacktestConfig, StrategySpec, run_backtest, validate_bars
from app.engine.models import CostModel, RiskLimits, SlippageBps
from app.engine.sessions import Crypto24x7Session
from tests.engine.test_backtest import MIXED_SPEC

BAR_COUNT = 500_000
BUDGET_SECONDS = 15.0

pytestmark = pytest.mark.skipif(
    os.environ.get("MYCELIUM_PERF") != "1",
    reason="performance measurement; run with MYCELIUM_PERF=1",
)


def synthetic_minutes(size: int) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.001, size)))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.001, size))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.001, size))
    index = pd.date_range("2022-01-01", periods=size, freq="1min", tz="UTC")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1.0}, index=index
    )


def test_500k_bars_run_well_under_the_budget():
    frame = synthetic_minutes(BAR_COUNT)
    config = BacktestConfig(
        session=Crypto24x7Session(),
        costs=CostModel(fee_pct=0.05, slippage=SlippageBps(value=2)),
        risk=RiskLimits(max_trades_per_session=50, max_session_loss_pct=5),
    )
    spec = StrategySpec.model_validate(MIXED_SPEC.model_dump())
    started = time.perf_counter()
    bars = validate_bars(frame, "1m")
    output = run_backtest(bars, spec, config)
    elapsed = time.perf_counter() - started
    print(f"\n{BAR_COUNT:,} bars, {len(output.result.trades):,} trades: {elapsed:.2f} s")
    assert elapsed < BUDGET_SECONDS
