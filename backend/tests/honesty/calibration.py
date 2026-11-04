from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.engine import BacktestConfig, StrategySpec, run_backtest, validate_bars
from app.engine.bars import BarSeries
from app.engine.models import CostModel, SlippageBps
from app.engine.sessions import Crypto24x7Session, UsEquitySession, nyse_calendar, session_bounds
from app.honesty.config import HonestyConfig
from app.honesty.model import HonestyReport
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.strategies.registry import build_spec, validate_parameters
from tests.strategies.helpers import random_crypto, random_us

HOURS_PER_YEAR = 8_760
THRESHOLD = 0.012
HOLD = 6
SIGMA = 0.006
CRYPTO_COSTS = CostModel(fee_pct=0.05, slippage=SlippageBps(value=1))
HEAVY_COSTS = CostModel(fee_pct=0.12, slippage=SlippageBps(value=5))
US_COSTS = CostModel(fee_pct=0.01, slippage=SlippageBps(value=1))


def _cond(left, op, coef):
    return {
        "left": {"kind": "close"},
        "op": op,
        "right": {"kind": "linear", "terms": [{"operand": {"kind": "prev_close"}, "coef": coef}]},
    }


MOMENTUM_SPEC = StrategySpec.model_validate(
    {
        "name": "Calibration momentum",
        "markets": ["crypto_24x7"],
        "long": {
            "entry": [_cond("close", ">", 1 + THRESHOLD)],
            "stop": {"type": "atr", "period": 14, "multiple": 4.0},
        },
        "short": {
            "entry": [_cond("close", "<", 1 - THRESHOLD)],
            "stop": {"type": "atr", "period": 14, "multiple": 4.0},
        },
        "time_exit": {"session_end": False, "max_bars": HOLD},
    }
)


def _frame_from_returns(returns: np.ndarray, rng: np.random.Generator, start: str) -> BarSeries:
    close = 100.0 * np.exp(np.cumsum(returns))
    open_ = np.r_[100.0, close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, SIGMA / 2, returns.size))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, SIGMA / 2, returns.size))
    index = pd.date_range(start, periods=returns.size, freq="1h", tz="UTC")
    frame = pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": 1_000.0},
        index=index,
    )
    return validate_bars(frame, "1h")


def planted(
    count: int,
    seed: int,
    drift: float,
    active: tuple[float, float] = (0.0, 1.0),
    start: str = "2024-01-01",
) -> BarSeries:
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, SIGMA, count)
    returns = np.empty(count)
    direction = 0
    remaining = 0
    first, last = int(active[0] * count), int(active[1] * count)
    for t in range(count):
        value = noise[t]
        if remaining > 0:
            if first <= t < last:
                value += drift * direction
            remaining -= 1
        if value > THRESHOLD:
            direction, remaining = 1, HOLD
        elif value < -THRESHOLD:
            direction, remaining = -1, HOLD
        returns[t] = value
    return _frame_from_returns(returns, rng, start)


def lucky(count: int, seed: int) -> BarSeries:
    rng = np.random.default_rng(seed)
    returns = rng.normal(0, SIGMA, count)
    k = 24 * 200
    returns[k - 10 : k] = np.clip(returns[k - 10 : k], -THRESHOLD / 3, THRESHOLD / 3)
    returns[k] = THRESHOLD * 1.5
    returns[k + 1 : k + 1 + HOLD] = 0.07
    return _frame_from_returns(returns, rng, "2024-01-01")


ORB_TEMPLATE = [
    (100.0, 100.3, 99.7, 100.1),
    (100.1, 100.3, 99.8, 99.9),
    (99.9, 100.2, 99.7, 100.2),
    (100.2, 100.3, 99.9, 100.0),
    (100.0, 100.45, 100.0, 100.4),
    (100.4, 100.5, 99.6, 100.5),
    (100.5, 101.0, 99.4, 99.5),
    (99.5, 100.75, 99.5, 100.7),
]


def _orb_session(count: int) -> list[tuple[float, float, float, float]]:
    rows = list(ORB_TEMPLATE)
    rise = np.linspace(100.7, 103.0, 14)[1:]
    fall = np.linspace(103.0, 99.0, 21)[1:]
    path = [*rise, *fall]
    previous = rows[-1][3]
    for close in path:
        rows.append((previous, max(previous, close) + 0.05, min(previous, close) - 0.05, close))
        previous = close
    while len(rows) < count:
        rows.append((previous, previous + 0.05, previous - 0.05, previous))
    return rows[:count]


def orb_spike(sessions: int, first: str = "2024-01-02") -> BarSeries:
    calendar = nyse_calendar()
    days = calendar.sessions[calendar.sessions >= pd.Timestamp(first)][:sessions]
    frames = []
    for number, day in enumerate(days):
        open_, close = session_bounds(UsEquitySession(), day.date())
        count = int((close - open_).total_seconds() // 300)
        scale = 1 + 0.0005 * number
        rows = np.array(_orb_session(count)) * scale
        index = pd.date_range(open_, periods=count, freq="5min")
        frames.append(pd.DataFrame(rows, index=index, columns=["open", "high", "low", "close"]))
    frame = pd.concat(frames)
    frame["volume"] = 1_000.0
    return validate_bars(frame, "5m")


@dataclass(frozen=True)
class Scenario:
    name: str
    expected: frozenset[str]
    noise: bool
    build: Callable[[], HonestyInput]


def _custom(bars: BarSeries, costs: CostModel = CRYPTO_COSTS) -> HonestyInput:
    config = BacktestConfig(session=Crypto24x7Session(), costs=costs)
    output = run_backtest(bars, MOMENTUM_SPEC, config)
    return HonestyInput(bars, MOMENTUM_SPEC, config, output, "custom", {"rules": "momentum"})


def _library(
    strategy_id: str,
    bars: BarSeries,
    market: str,
    values: dict | None = None,
    names: tuple[str, ...] | None = None,
) -> HonestyInput:
    session = Crypto24x7Session() if market == "crypto_24x7" else UsEquitySession()
    costs = CRYPTO_COSTS if market == "crypto_24x7" else US_COSTS
    config = BacktestConfig(session=session, costs=costs)
    params = validate_parameters(strategy_id, values or {}, market)
    spec = build_spec(strategy_id, params, market)
    output = run_backtest(bars, spec, config)
    request = SweepRequest(strategy_id, params, market, names)
    return HonestyInput(bars, spec, config, output, strategy_id, params, request)


NOT_CREDIBLE = frozenset({"NOT_CREDIBLE"})
WEAK = frozenset({"FRAGILE", "NOT_CREDIBLE"})

SCENARIOS: tuple[Scenario, ...] = (
    Scenario(
        "noise_custom_momentum",
        WEAK,
        True,
        lambda: _custom(planted(HOURS_PER_YEAR, 101, 0.0)),
    ),
    Scenario(
        "noise_donchian_crypto",
        WEAK,
        True,
        lambda: _library("donchian_breakout", random_crypto(HOURS_PER_YEAR, 102), "crypto_24x7"),
    ),
    Scenario(
        "noise_rsi_crypto",
        WEAK,
        True,
        lambda: _library("rsi_mean_reversion", random_crypto(HOURS_PER_YEAR, 103), "crypto_24x7"),
    ),
    Scenario(
        "noise_orb_us",
        WEAK,
        True,
        lambda: _library("orb", random_us(250, seed=104, timeframe="5m"), "us_equity"),
    ),
    Scenario(
        "noise_vwap_us",
        WEAK,
        True,
        lambda: _library(
            "vwap_mean_reversion", random_us(250, seed=105, timeframe="5m"), "us_equity"
        ),
    ),
    Scenario(
        "planted_edge",
        frozenset({"CREDIBLE"}),
        False,
        lambda: _custom(planted(HOURS_PER_YEAR, 106, 0.001)),
    ),
    Scenario(
        "edge_vanishes_after_costs",
        NOT_CREDIBLE,
        False,
        lambda: _custom(planted(HOURS_PER_YEAR, 107, 0.0004), HEAVY_COSTS),
    ),
    Scenario(
        "one_lucky_trade",
        WEAK,
        False,
        lambda: _custom(lucky(HOURS_PER_YEAR, 108)),
    ),
    Scenario(
        "parameter_spike",
        WEAK,
        False,
        lambda: _library(
            "orb",
            orb_spike(130),
            "us_equity",
            {"range_minutes": 30, "min_range_atr": 0.0, "target_r": 2.0, "directions": "long"},
            ("range_minutes",),
        ),
    ),
    Scenario(
        "too_few_trades",
        NOT_CREDIBLE,
        False,
        lambda: _custom(planted(24 * 30, 109, 0.001)),
    ),
    Scenario(
        "strong_first_part_dead_last",
        WEAK,
        False,
        lambda: _custom(planted(HOURS_PER_YEAR, 110, 0.001, active=(0.0, 0.7))),
    ),
    Scenario(
        "profit_in_one_period",
        WEAK,
        False,
        lambda: _custom(planted(HOURS_PER_YEAR, 111, 0.0015, active=(0.3, 0.45))),
    ),
)


def run_scenario(scenario: Scenario, config: HonestyConfig | None = None) -> HonestyReport:
    return build_report(scenario.build(), config or HonestyConfig(), clock=lambda: 0.0)
