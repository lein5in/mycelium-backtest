import json
import math
from collections.abc import Mapping
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.engine.sessions import MarketKind
from app.engine.spec import Comparator, StrategySpec
from app.strategies.base import check_market

MAX_SERIALIZED_BYTES = 20_000
MAX_DEPTH = 8
MAX_NODES = 1_000
MAX_STRING_LENGTH = 64
MAX_ENTRY_CONDITIONS = 6
MAX_EXIT_CONDITIONS = 3
MAX_PARAMETERS = 12
MIN_PERIOD = 2
MAX_PERIOD = 500
MAX_ABS_CONSTANT = 1e6
MAX_MULTIPLE = 20.0
MAX_BARS_HELD = 1_000
NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,63}$"

LIMITS = {
    "max_entry_conditions": MAX_ENTRY_CONDITIONS,
    "max_exit_conditions": MAX_EXIT_CONDITIONS,
    "max_parameters": MAX_PARAMETERS,
    "min_period": MIN_PERIOD,
    "max_period": MAX_PERIOD,
    "max_bars_held": MAX_BARS_HELD,
    "max_serialized_bytes": MAX_SERIALIZED_BYTES,
}

Period = Annotated[int, Field(ge=MIN_PERIOD, le=MAX_PERIOD)]
SaneNumber = Annotated[float, Field(ge=-MAX_ABS_CONSTANT, le=MAX_ABS_CONSTANT)]
Multiple = Annotated[float, Field(gt=0, le=MAX_MULTIPLE)]


class CustomStrategyError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("; ".join(problems))


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)


class PriceOperand(Strict):
    kind: Literal["open", "high", "low", "close", "prev_close", "vwap"]


class IndicatorOperand(Strict):
    kind: Literal["sma", "ema", "rsi", "atr", "adx", "donchian_high", "donchian_low"]
    period: Period


class ConstantOperand(Strict):
    kind: Literal["constant"]
    value: SaneNumber


Operand = Annotated[PriceOperand | IndicatorOperand | ConstantOperand, Field(discriminator="kind")]


class CustomCondition(Strict):
    left: Operand
    op: Comparator
    right: Operand


class FixedStop(Strict):
    type: Literal["fixed"]
    distance: Annotated[float, Field(gt=0, le=MAX_ABS_CONSTANT)]


class AtrStop(Strict):
    type: Literal["atr"]
    period: Period = 14
    multiple: Multiple


class LevelStop(Strict):
    type: Literal["level"]
    level: Operand


class RMultipleTarget(Strict):
    type: Literal["r_multiple"]
    multiple: Multiple


class LevelTarget(Strict):
    type: Literal["level"]
    level: Operand


class MovingTarget(Strict):
    type: Literal["moving"]
    level: Operand


Stop = Annotated[FixedStop | AtrStop | LevelStop, Field(discriminator="type")]
Target = Annotated[RMultipleTarget | LevelTarget | MovingTarget, Field(discriminator="type")]


class CustomSide(Strict):
    entry: Annotated[list[CustomCondition], Field(min_length=1, max_length=MAX_ENTRY_CONDITIONS)]
    exit: Annotated[list[CustomCondition], Field(max_length=MAX_EXIT_CONDITIONS)] = Field(
        default_factory=list
    )
    stop: Stop
    target: Target | None = None


class CustomTimeExit(Strict):
    session_end: bool = True
    max_bars: Annotated[int, Field(ge=1, le=MAX_BARS_HELD)] | None = None


class CustomDescription(Strict):
    name: Annotated[str, Field(pattern=NAME_PATTERN)]
    markets: Annotated[list[MarketKind], Field(min_length=1, max_length=2)]
    long: CustomSide | None = None
    short: CustomSide | None = None
    time_exit: CustomTimeExit = Field(default_factory=CustomTimeExit)

    @model_validator(mode="after")
    def coherent(self) -> "CustomDescription":
        if self.long is None and self.short is None:
            raise ValueError("a custom strategy needs long rules, short rules, or both")
        if len(set(self.markets)) != len(self.markets):
            raise ValueError("markets must not repeat")
        count = parameter_count(self)
        if count > MAX_PARAMETERS:
            raise ValueError(
                f"too many parameters: {count} distinct values, at most {MAX_PARAMETERS}"
            )
        return self


def _operand_keys(operand: PriceOperand | IndicatorOperand | ConstantOperand) -> set[tuple]:
    if isinstance(operand, IndicatorOperand):
        return {("indicator", operand.kind, operand.period)}
    if isinstance(operand, ConstantOperand):
        return {("constant", operand.value)}
    return set()


def parameter_count(description: CustomDescription) -> int:
    found: set[tuple] = set()
    for side in (description.long, description.short):
        if side is None:
            continue
        for condition in [*side.entry, *side.exit]:
            found |= _operand_keys(condition.left) | _operand_keys(condition.right)
        stop = side.stop
        if isinstance(stop, FixedStop):
            found.add(("stop_distance", stop.distance))
        elif isinstance(stop, AtrStop):
            found |= {("indicator", "atr", stop.period), ("stop_multiple", stop.multiple)}
        else:
            found |= _operand_keys(stop.level)
        target = side.target
        if isinstance(target, RMultipleTarget):
            found.add(("target_multiple", target.multiple))
        elif target is not None:
            found |= _operand_keys(target.level)
    if description.time_exit.max_bars is not None:
        found.add(("max_bars", description.time_exit.max_bars))
    return len(found)


def _reject_constant(token: str) -> None:
    raise CustomStrategyError([f"non-finite number {token} is not allowed"])


def _check_shape(data: object) -> None:
    stack: list[tuple[object, int]] = [(data, 1)]
    nodes = 0
    while stack:
        node, depth = stack.pop()
        nodes += 1
        if nodes > MAX_NODES:
            raise CustomStrategyError([f"description has more than {MAX_NODES} elements"])
        if depth > MAX_DEPTH:
            raise CustomStrategyError([f"description is nested deeper than {MAX_DEPTH} levels"])
        if isinstance(node, Mapping):
            for key, value in node.items():
                if not isinstance(key, str) or len(key) > MAX_STRING_LENGTH:
                    raise CustomStrategyError(["object keys must be short strings"])
                stack.append((value, depth + 1))
        elif isinstance(node, list):
            stack.extend((value, depth + 1) for value in node)
        elif isinstance(node, str):
            if len(node) > MAX_STRING_LENGTH:
                raise CustomStrategyError([f"strings are limited to {MAX_STRING_LENGTH} chars"])
        elif isinstance(node, float):
            if not math.isfinite(node):
                raise CustomStrategyError([f"non-finite number {node} is not allowed"])
        elif node is not None and not isinstance(node, bool | int):
            raise CustomStrategyError([f"unsupported value of type {type(node).__name__}"])


def _load(raw: object) -> object:
    if isinstance(raw, bytes | bytearray):
        if len(raw) > MAX_SERIALIZED_BYTES:
            raise CustomStrategyError([f"description is larger than {MAX_SERIALIZED_BYTES} bytes"])
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError as error:
            raise CustomStrategyError(["description must be UTF-8 JSON"]) from error
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > MAX_SERIALIZED_BYTES:
            raise CustomStrategyError([f"description is larger than {MAX_SERIALIZED_BYTES} bytes"])
        try:
            return json.loads(raw, parse_constant=_reject_constant)
        except RecursionError as error:
            raise CustomStrategyError(["description is nested too deeply"]) from error
        except json.JSONDecodeError as error:
            raise CustomStrategyError([f"description is not valid JSON: {error.msg}"]) from error
    return raw


def parse_description(raw: object) -> CustomDescription:
    data = _load(raw)
    if not isinstance(data, Mapping):
        raise CustomStrategyError(["description must be a JSON object"])
    _check_shape(data)
    size = len(json.dumps(data, allow_nan=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_SERIALIZED_BYTES:
        raise CustomStrategyError([f"description is larger than {MAX_SERIALIZED_BYTES} bytes"])
    try:
        return CustomDescription.model_validate(dict(data))
    except ValidationError as error:
        problems = [
            f"{'.'.join(str(part) for part in item['loc']) or 'description'}: {item['msg']}"
            for item in error.errors(include_url=False, include_input=False)
        ]
        raise CustomStrategyError(problems) from None


def _side(side: CustomSide | None) -> dict | None:
    if side is None:
        return None
    rules: dict = {
        "entry": [condition.model_dump() for condition in side.entry],
        "stop": side.stop.model_dump(),
        "exit_any": [condition.model_dump() for condition in side.exit],
    }
    if side.target is not None:
        rules["target"] = side.target.model_dump()
    return rules


def to_spec(description: CustomDescription) -> StrategySpec:
    return StrategySpec.model_validate(
        {
            "name": description.name,
            "markets": list(description.markets),
            "long": _side(description.long),
            "short": _side(description.short),
            "time_exit": description.time_exit.model_dump(),
        }
    )


def build_custom(raw: object, market: MarketKind) -> StrategySpec:
    description = parse_description(raw)
    check_market("This custom strategy", tuple(description.markets), market, None)
    return to_spec(description)
