from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.engine.sessions import MarketKind

SPEC_SCHEMA_VERSION = 1
MAX_PERIOD = 1_000
MAX_ABS_CONSTANT = 1e9
MAX_LINEAR_TERMS = 4
MAX_ENTRY_CONDITIONS = 12
MAX_EXIT_CONDITIONS = 6

Period = Annotated[int, Field(ge=1, le=MAX_PERIOD, strict=True)]
Coefficient = Annotated[float, Field(ge=-MAX_ABS_CONSTANT, le=MAX_ABS_CONSTANT)]
PositiveMultiple = Annotated[float, Field(gt=0, le=1_000)]

PRICE_KINDS = ("open", "high", "low", "close", "prev_close")
PERIODIC_KINDS = (
    "sma",
    "ema",
    "rsi",
    "atr",
    "adx",
    "donchian_high",
    "donchian_low",
    "vwap_dev_std",
)
SESSION_KINDS = (
    "vwap",
    "prev_session_close",
    "session_open",
    "bar_in_session",
    "minutes_since_open",
)


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Price(Frozen):
    kind: Literal["open", "high", "low", "close", "prev_close"]

    @property
    def key(self) -> tuple:
        return (self.kind,)


class Periodic(Frozen):
    kind: Literal[
        "sma",
        "ema",
        "rsi",
        "atr",
        "adx",
        "donchian_high",
        "donchian_low",
        "vwap_dev_std",
    ]
    period: Period

    @property
    def key(self) -> tuple:
        return (self.kind, self.period)


class SessionValue(Frozen):
    kind: Literal[
        "vwap",
        "prev_session_close",
        "session_open",
        "bar_in_session",
        "minutes_since_open",
    ]

    @property
    def key(self) -> tuple:
        return (self.kind,)


class OpeningRange(Frozen):
    kind: Literal["opening_range_high", "opening_range_low"]
    minutes: Annotated[int, Field(ge=1, le=1_440, strict=True)]

    @property
    def key(self) -> tuple:
        return (self.kind, self.minutes)


class Constant(Frozen):
    kind: Literal["constant"] = "constant"
    value: Coefficient

    @property
    def key(self) -> tuple:
        return (self.kind, self.value)


Operand = Annotated[
    Price | Periodic | SessionValue | OpeningRange | Constant, Field(discriminator="kind")
]


class Term(Frozen):
    operand: Operand
    coef: Coefficient = 1.0


class Linear(Frozen):
    kind: Literal["linear"] = "linear"
    terms: Annotated[list[Term], Field(min_length=1, max_length=MAX_LINEAR_TERMS)]
    constant: Coefficient = 0.0


Expr = Annotated[
    Price | Periodic | SessionValue | OpeningRange | Constant | Linear,
    Field(discriminator="kind"),
]

Comparator = Literal[">", "<", ">=", "<=", "crosses_above", "crosses_below"]


class Condition(Frozen):
    left: Expr
    op: Comparator
    right: Expr


class FixedStop(Frozen):
    type: Literal["fixed"] = "fixed"
    distance: Annotated[float, Field(gt=0, le=MAX_ABS_CONSTANT)]


class AtrStop(Frozen):
    type: Literal["atr"] = "atr"
    period: Period = 14
    multiple: PositiveMultiple


class LevelStop(Frozen):
    type: Literal["level"] = "level"
    level: Expr


StopRule = Annotated[FixedStop | AtrStop | LevelStop, Field(discriminator="type")]


class RMultipleTarget(Frozen):
    type: Literal["r_multiple"] = "r_multiple"
    multiple: PositiveMultiple


class LevelTarget(Frozen):
    type: Literal["level"] = "level"
    level: Expr


class MovingTarget(Frozen):
    type: Literal["moving"] = "moving"
    level: Expr


TargetRule = Annotated[RMultipleTarget | LevelTarget | MovingTarget, Field(discriminator="type")]


class SideRules(Frozen):
    entry: Annotated[list[Condition], Field(min_length=1, max_length=MAX_ENTRY_CONDITIONS)]
    stop: StopRule
    target: TargetRule | None = None
    exit_any: Annotated[list[Condition], Field(max_length=MAX_EXIT_CONDITIONS)] = Field(
        default_factory=list
    )


class TimeExit(Frozen):
    session_end: bool = True
    max_bars: Annotated[int, Field(ge=1, le=100_000, strict=True)] | None = None


class StrategySpec(Frozen):
    schema_version: Literal[1] = SPEC_SCHEMA_VERSION
    name: Annotated[str, Field(min_length=1, max_length=64)]
    markets: Annotated[list[MarketKind], Field(min_length=1, max_length=2)]
    long: SideRules | None = None
    short: SideRules | None = None
    time_exit: TimeExit = Field(default_factory=TimeExit)

    @model_validator(mode="after")
    def coherent(self) -> "StrategySpec":
        if self.long is None and self.short is None:
            raise ValueError("a strategy needs long rules, short rules, or both")
        if len(set(self.markets)) != len(self.markets):
            raise ValueError("markets must not repeat")
        return self


def operands(expr: Price | Periodic | SessionValue | OpeningRange | Constant | Linear) -> list:
    if isinstance(expr, Linear):
        return [term.operand for term in expr.terms]
    return [expr]


def side_operands(rules: SideRules) -> list:
    found: list = []
    for condition in [*rules.entry, *rules.exit_any]:
        found.extend(operands(condition.left))
        found.extend(operands(condition.right))
    if isinstance(rules.stop, AtrStop):
        found.append(Periodic(kind="atr", period=rules.stop.period))
    if isinstance(rules.stop, LevelStop):
        found.extend(operands(rules.stop.level))
    if isinstance(rules.target, LevelTarget | MovingTarget):
        found.extend(operands(rules.target.level))
    return found
