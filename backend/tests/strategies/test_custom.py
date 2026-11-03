import copy
import json

import pytest

from app.engine import IncompatibleMarketError
from app.strategies import donchian_breakout, rsi_mean_reversion
from app.strategies.custom import (
    MAX_SERIALIZED_BYTES,
    CustomStrategyError,
    build_custom,
    parameter_count,
    parse_description,
)
from tests.strategies.helpers import CRYPTO, US, random_crypto, random_us, run


def op(kind, period=None):
    return {"kind": kind} if period is None else {"kind": kind, "period": period}


def const(value):
    return {"kind": "constant", "value": value}


def cond(left, operator, right):
    return {"left": left, "op": operator, "right": right}


RSI_CUSTOM = {
    "name": "My RSI pullback",
    "markets": ["us_equity", "crypto_24x7"],
    "long": {
        "entry": [
            cond(op("rsi", 14), "crosses_above", const(30)),
            cond(op("close"), ">", op("sma", 200)),
        ],
        "exit": [cond(op("rsi", 14), ">=", const(50))],
        "stop": {"type": "atr", "period": 14, "multiple": 2.0},
    },
    "short": {
        "entry": [
            cond(op("rsi", 14), "crosses_below", const(70)),
            cond(op("close"), "<", op("sma", 200)),
        ],
        "exit": [cond(op("rsi", 14), "<=", const(50))],
        "stop": {"type": "atr", "period": 14, "multiple": 2.0},
    },
    "time_exit": {"session_end": False, "max_bars": 10},
}

DONCHIAN_CUSTOM = {
    "name": "My channel breakout",
    "markets": ["crypto_24x7", "us_equity"],
    "long": {
        "entry": [cond(op("close"), ">", op("donchian_high", 20))],
        "exit": [cond(op("close"), "<", op("donchian_low", 10))],
        "stop": {"type": "atr", "multiple": 2},
    },
    "short": {
        "entry": [cond(op("close"), "<", op("donchian_low", 20))],
        "exit": [cond(op("close"), ">", op("donchian_high", 10))],
        "stop": {"type": "atr", "multiple": 2},
    },
    "time_exit": {"session_end": False},
}


def test_custom_rsi_reproduces_the_library_rsi_mean_reversion_exactly():
    bars = random_crypto(2_000, seed=31)
    library = run(rsi_mean_reversion.STRATEGY.spec(None, "crypto_24x7"), bars, CRYPTO)
    custom = run(build_custom(RSI_CUSTOM, "crypto_24x7"), bars, CRYPTO)
    assert len(library.trades) >= 5
    assert custom.trades == library.trades


def test_custom_rsi_long_only_matches_the_us_equity_default():
    bars = random_us(30, seed=32, timeframe="15m")
    long_only = {key: value for key, value in RSI_CUSTOM.items() if key != "short"}
    library = run(rsi_mean_reversion.STRATEGY.spec(None, "us_equity"), bars, US)
    assert run(build_custom(long_only, "us_equity"), bars, US).trades == library.trades


def test_custom_donchian_reproduces_the_library_donchian_exactly():
    bars = random_crypto(1_500, seed=33)
    library = run(donchian_breakout.STRATEGY.spec(None, "crypto_24x7"), bars, CRYPTO)
    custom = run(build_custom(json.dumps(DONCHIAN_CUSTOM), "crypto_24x7"), bars, CRYPTO)
    assert len(library.trades) >= 5
    assert custom.trades == library.trades


def test_every_operand_and_rule_type_is_accepted():
    description = {
        "name": "Everything",
        "markets": ["crypto_24x7"],
        "long": {
            "entry": [
                cond(op("open"), ">", op("prev_close")),
                cond(op("high"), ">=", op("ema", 9)),
                cond(op("low"), "<=", op("vwap")),
                cond(op("adx", 14), ">", const(20)),
                cond(op("close"), "crosses_above", op("sma", 20)),
            ],
            "exit": [cond(op("close"), "crosses_below", op("donchian_low", 5))],
            "stop": {"type": "level", "level": op("donchian_low", 10)},
            "target": {"type": "moving", "level": op("donchian_high", 30)},
        },
        "short": {
            "entry": [cond(op("close"), "<", op("ema", 9))],
            "stop": {"type": "fixed", "distance": 2.5},
            "target": {"type": "r_multiple", "multiple": 2},
        },
        "time_exit": {"session_end": True, "max_bars": 50},
    }
    spec = build_custom(description, "crypto_24x7")
    assert spec.name == "Everything" and spec.long and spec.short
    assert len(run(spec, random_crypto(600, seed=34), CRYPTO).trades) > 0
    level_target = copy.deepcopy(description)
    level_target["short"]["target"] = {"type": "level", "level": const(1)}
    assert build_custom(level_target, "crypto_24x7").short.target.type == "level"


def test_market_choice_is_validated():
    only_crypto = {**DONCHIAN_CUSTOM, "markets": ["crypto_24x7"]}
    with pytest.raises(IncompatibleMarketError, match="supports crypto"):
        build_custom(only_crypto, "us_equity")
    assert build_custom(DONCHIAN_CUSTOM, "us_equity").markets == ["crypto_24x7", "us_equity"]


def test_parameter_count_counts_distinct_values():
    assert parameter_count(parse_description(RSI_CUSTOM)) == 8
    assert parameter_count(parse_description(DONCHIAN_CUSTOM)) == 6


def mutated(change):
    description = copy.deepcopy(RSI_CUSTOM)
    change(description)
    return description


def nested(depth):
    node = {"kind": "close"}
    for _ in range(depth):
        node = {"inner": node}
    return node


HOSTILE = {
    "name_with_code": mutated(lambda d: d.update(name="__import__('os').system('ls')")),
    "name_with_template": mutated(lambda d: d.update(name="{{7*7}}")),
    "kind_eval": mutated(lambda d: d["long"]["entry"][0].update(left={"kind": "eval"})),
    "kind_python_expression": mutated(
        lambda d: d["long"]["entry"][0].update(left={"kind": "close.__class__"})
    ),
    "operator_code": mutated(lambda d: d["long"]["entry"][0].update(op="lambda: 1")),
    "operator_equals": mutated(lambda d: d["long"]["entry"][0].update(op="==")),
    "string_constant": mutated(lambda d: d["long"]["entry"][0].update(right=const("30"))),
    "code_constant": mutated(lambda d: d["long"]["entry"][0].update(right=const("exec('x')"))),
    "string_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", "14"))),
    "float_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", 14.0))),
    "bool_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", True))),
    "negative_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", -14))),
    "zero_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", 0))),
    "period_one": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", 1))),
    "huge_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", 10**18))),
    "astronomic_period": mutated(lambda d: d["long"]["entry"][0].update(left=op("rsi", 10**400))),
    "huge_constant": mutated(lambda d: d["long"]["entry"][0].update(right=const(1e308))),
    "nan_constant": mutated(lambda d: d["long"]["entry"][0].update(right=const(float("nan")))),
    "inf_constant": mutated(lambda d: d["long"]["entry"][0].update(right=const(float("inf")))),
    "huge_stop_multiple": mutated(lambda d: d["long"]["stop"].update(multiple=1e9)),
    "negative_stop_multiple": mutated(lambda d: d["long"]["stop"].update(multiple=-2)),
    "huge_max_bars": mutated(lambda d: d["time_exit"].update(max_bars=10**9)),
    "unknown_root_field": mutated(lambda d: d.update(script="print(1)")),
    "unknown_side_field": mutated(lambda d: d["long"].update(code="1")),
    "unknown_condition_field": mutated(lambda d: d["long"]["entry"][0].update(source="x")),
    "unknown_operand_field": mutated(
        lambda d: d["long"]["entry"][0]["left"].update(expression="close*2")
    ),
    "seven_entry_conditions": mutated(
        lambda d: d["long"].update(entry=[cond(op("close"), ">", const(i)) for i in range(7)])
    ),
    "four_exit_conditions": mutated(
        lambda d: d["long"].update(exit=[cond(op("close"), ">", const(i)) for i in range(4)])
    ),
    "thirteen_parameters": mutated(
        lambda d: d["long"].update(
            entry=[cond(op("sma", 2 + i), ">", const(i)) for i in range(6)],
            exit=[cond(op("close"), ">", op("ema", 50))],
        )
    ),
    "deep_nesting": mutated(lambda d: d["long"]["entry"][0].update(left=nested(50))),
    "missing_stop": mutated(lambda d: d["long"].pop("stop")),
    "no_sides": mutated(lambda d: [d.pop("long"), d.pop("short")]),
    "no_markets": mutated(lambda d: d.update(markets=[])),
    "unknown_market": mutated(lambda d: d.update(markets=["forex"])),
    "duplicate_markets": mutated(lambda d: d.update(markets=["us_equity", "us_equity"])),
    "linear_expression_not_allowed": mutated(
        lambda d: d["long"]["entry"][0].update(
            right={"kind": "linear", "terms": [{"operand": op("close")}]}
        )
    ),
    "opening_range_not_whitelisted": mutated(
        lambda d: d["long"]["entry"][0].update(right={"kind": "opening_range_high", "minutes": 30})
    ),
    "object_value": mutated(lambda d: d.update(name=object())),
    "set_value": mutated(lambda d: d.update(markets={"us_equity"})),
    "non_string_key": mutated(lambda d: d["long"].update({1: "x"})),
    "long_string": mutated(lambda d: d.update(name="a" * 5_000)),
}

HOSTILE_RAW = {
    "list_top_level": [RSI_CUSTOM],
    "number_top_level": 42,
    "none_top_level": None,
    "json_nan_token": json.dumps(RSI_CUSTOM).replace("30.0", "NaN").replace("30", "NaN"),
    "json_infinity_token": json.dumps(RSI_CUSTOM).replace("70", "Infinity"),
    "json_negative_infinity": json.dumps(RSI_CUSTOM).replace("70", "-Infinity"),
    "json_deep_brackets": "[" * 5_000 + "]" * 5_000,
    "json_oversized": json.dumps(RSI_CUSTOM) + " " * MAX_SERIALIZED_BYTES,
    "json_invalid": "{'name': 'x'}",
    "json_huge_integer": json.dumps(RSI_CUSTOM).replace('"period": 200', '"period": 1' + "0" * 500),
    "bytes_not_utf8": b"\xff\xfe\x00",
    "python_code_string": "__import__('os').system('ls')",
}


@pytest.mark.parametrize("name", sorted(HOSTILE))
def test_hostile_descriptions_are_rejected(name):
    with pytest.raises(CustomStrategyError) as caught:
        build_custom(HOSTILE[name], "crypto_24x7")
    assert caught.value.problems and all(problem for problem in caught.value.problems)


@pytest.mark.parametrize("name", sorted(HOSTILE_RAW))
def test_hostile_raw_payloads_are_rejected(name):
    with pytest.raises(CustomStrategyError):
        build_custom(HOSTILE_RAW[name], "crypto_24x7")


def test_oversized_mapping_is_rejected():
    description = mutated(
        lambda d: d["long"].update(
            entry=[cond(op("close"), ">", const(1.0))] * 6,
            exit=[cond(op("close"), "<", const(1.0))] * 3,
        )
    )
    assert len(json.dumps(description)) < MAX_SERIALIZED_BYTES
    assert build_custom(description, "crypto_24x7")
    padded = mutated(lambda d: d.update(name="x"))
    padded["long"]["entry"] = [cond(op("close"), ">", const(1.0))] * 6
    with pytest.raises(CustomStrategyError):
        build_custom({**padded, "padding": ["x" * 60] * 400}, "crypto_24x7")


def test_error_messages_name_the_field():
    with pytest.raises(CustomStrategyError) as caught:
        build_custom(HOSTILE["negative_period"], "crypto_24x7")
    assert any("long.entry.0.left" in problem for problem in caught.value.problems)
