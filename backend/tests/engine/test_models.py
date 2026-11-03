import copy
import math

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from app.engine.bars import BarsValidationError, validate_bars
from app.engine.models import BacktestConfig, CostModel, RiskLimits, SlippageBps
from app.engine.spec import StrategySpec
from tests.engine.factories import frame

RSI_SPEC = {
    "name": "rsi mean reversion",
    "markets": ["us_equity", "crypto_24x7"],
    "long": {
        "entry": [
            {
                "left": {"kind": "rsi", "period": 14},
                "op": "crosses_above",
                "right": {"kind": "constant", "value": 30},
            },
            {"left": {"kind": "close"}, "op": ">", "right": {"kind": "sma", "period": 200}},
        ],
        "stop": {"type": "atr", "period": 14, "multiple": 2.0},
        "exit_any": [
            {
                "left": {"kind": "rsi", "period": 14},
                "op": ">=",
                "right": {"kind": "constant", "value": 50},
            }
        ],
    },
    "time_exit": {"session_end": False, "max_bars": 10},
}


def codes(error: BarsValidationError) -> set[str]:
    return {problem.code for problem in error.problems}


def test_valid_bars_become_float_arrays_in_ns():
    bars = validate_bars(frame([(10, 11, 9, 10.5), (10.5, 12, 10, 11)], "2024-01-01"), "1h")
    assert bars.size == 2 and bars.ts_ns.dtype == np.int64
    assert bars.ts_ns[1] - bars.ts_ns[0] == 3_600 * 10**9
    assert bars.interval_minutes == 60


def test_every_bar_problem_is_reported_at_once():
    data = frame(
        [
            (10, 11, 9, 10),
            (10, 9, 11, 10),
            (12, 11, 9, 10),
            (10, 11, 9, 13),
            (-1, 11, -2, 10),
            (10, 11, 9, float("nan")),
        ],
        "2024-01-01",
    )
    data.iloc[0, 4] = -5
    data.index = data.index[[0, 1, 1, 2, 4, 3]]
    with pytest.raises(BarsValidationError) as caught:
        validate_bars(data, "1h")
    assert codes(caught.value) == {
        "duplicate_timestamp",
        "not_increasing",
        "high_below_low",
        "open_outside_range",
        "close_outside_range",
        "non_positive_price",
        "invalid_close",
        "negative_volume",
    }
    assert all(problem.count >= 1 and problem.examples for problem in caught.value.problems)


def test_naive_and_non_utc_timestamps_are_rejected():
    data = frame([(10, 11, 9, 10)], "2024-01-01")
    with pytest.raises(BarsValidationError) as naive:
        validate_bars(data.tz_localize(None), "1h")
    assert codes(naive.value) == {"naive_timestamps"}
    with pytest.raises(BarsValidationError) as paris:
        validate_bars(data.tz_convert("Europe/Paris"), "1h")
    assert codes(paris.value) == {"not_utc"}


def test_missing_columns_empty_frames_and_unknown_timeframes_are_rejected():
    with pytest.raises(BarsValidationError) as missing:
        validate_bars(frame([(10, 11, 9, 10)], "2024-01-01").drop(columns=["volume"]), "1h")
    assert missing.value.problems[0].examples == ["volume"]
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], tz="UTC"),
    )
    with pytest.raises(BarsValidationError) as nothing:
        validate_bars(empty, "1h")
    assert codes(nothing.value) == {"empty"}
    with pytest.raises(BarsValidationError):
        validate_bars(frame([(10, 11, 9, 10)], "2024-01-01"), "2h")


def test_cost_model_fee_and_slippage_arithmetic():
    costs = CostModel(fee_pct=0.1, fixed_fee=1.0)
    assert costs.fee(10_000) == pytest.approx(11.0)
    assert costs.slip(100.0, 0.25) == 0.0
    assert CostModel(slippage={"unit": "ticks", "value": 2}).slip(100.0, 0.25) == 0.5
    assert CostModel(slippage=SlippageBps(value=5)).slip(200.0, 0.01) == pytest.approx(0.1)


def test_config_defaults_and_bounds():
    config = BacktestConfig()
    assert config.initial_capital == 10_000 and config.compounding is False
    assert config.risk.max_trades_per_session == 1
    assert config.sizing.type == "fixed_fraction" and config.sizing.fraction == 1.0
    assert config.annualisation_days == 252
    assert BacktestConfig(session={"kind": "crypto_24x7"}).annualisation_days == 365
    for bad in (
        {"fee_pct": -0.1},
        {"fee_pct": math.inf},
        {"slippage": {"unit": "percent", "value": 1}},
    ):
        with pytest.raises(ValidationError):
            CostModel.model_validate(bad)
    with pytest.raises(ValidationError):
        RiskLimits(max_trades_per_session=0)
    with pytest.raises(ValidationError):
        BacktestConfig.model_validate({"sizing": {"type": "fixed_fraction", "fraction": 2.0}})
    with pytest.raises(ValidationError):
        BacktestConfig.model_validate({"leverage": 5})


def test_strategy_spec_round_trips_through_json():
    spec = StrategySpec.model_validate(RSI_SPEC)
    assert StrategySpec.model_validate_json(spec.model_dump_json()) == spec
    assert spec.schema_version == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: s.pop("long"),
        lambda s: s.update(markets=[]),
        lambda s: s.update(markets=["forex"]),
        lambda s: s.update(markets=["us_equity", "us_equity"]),
        lambda s: s["long"].pop("stop"),
        lambda s: s["long"].update(entry=[]),
        lambda s: s["long"]["entry"][0]["left"].update(period=0),
        lambda s: s["long"]["entry"][0]["left"].update(period="14"),
        lambda s: s["long"]["entry"][0]["left"].update(period=14.5),
        lambda s: s["long"]["entry"][0]["left"].update(kind="__import__"),
        lambda s: s["long"]["entry"][0].update(op="eval"),
        lambda s: s["long"]["entry"][0]["right"].update(value=float("nan")),
        lambda s: s["long"]["entry"][0]["right"].update(value=1e300),
        lambda s: s["long"].update(code="print(1)"),
        lambda s: s["long"]["stop"].update(multiple=-1),
        lambda s: s["time_exit"].update(max_bars=0),
    ],
)
def test_invalid_strategy_specs_are_rejected(mutation):
    spec = copy.deepcopy(RSI_SPEC)
    mutation(spec)
    with pytest.raises(ValidationError):
        StrategySpec.model_validate(spec)


def test_linear_expressions_are_bounded_and_not_nested():
    spec = copy.deepcopy(RSI_SPEC)
    linear = {"kind": "linear", "terms": [{"operand": {"kind": "vwap"}, "coef": 1.0}]}
    spec["long"]["entry"][0]["right"] = linear
    StrategySpec.model_validate(spec)
    linear["terms"] = [{"operand": {"kind": "vwap"}}] * 5
    with pytest.raises(ValidationError):
        StrategySpec.model_validate(spec)
    linear["terms"] = [{"operand": {"kind": "linear", "terms": [{"operand": {"kind": "close"}}]}}]
    with pytest.raises(ValidationError):
        StrategySpec.model_validate(spec)
