import math
from collections.abc import Mapping
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.engine.sessions import MarketKind

ParamValue = int | float | str
STEP_TOLERANCE = 1e-9


class ParameterError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("; ".join(problems))


class ParamDef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
    label: str
    type: Literal["int", "float", "choice"]
    default: ParamValue
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = None
    choices: list[str] | None = None
    market_defaults: dict[MarketKind, ParamValue] | None = None
    unit: str | None = None
    description: str

    def default_for(self, market: MarketKind) -> ParamValue:
        if self.market_defaults and market in self.market_defaults:
            return self.market_defaults[market]
        return self.default

    def problem(self, value: object) -> str | None:
        if self.type == "choice":
            if not isinstance(value, str) or value not in (self.choices or []):
                options = ", ".join(self.choices or [])
                return f"{self.name} must be one of {options}, got {value!r}"
            return None
        if isinstance(value, bool) or not isinstance(value, int | float):
            return f"{self.name} must be a number, got {type(value).__name__}"
        if self.type == "int" and not isinstance(value, int):
            return f"{self.name} must be a whole number, got {value!r}"
        if not math.isfinite(value):
            return f"{self.name} must be finite, got {value!r}"
        assert self.minimum is not None and self.maximum is not None and self.step is not None
        if not self.minimum <= value <= self.maximum:
            return (
                f"{self.name} must be between {self.minimum:g} and {self.maximum:g}, got {value:g}"
            )
        steps = (value - self.minimum) / self.step
        if abs(steps - round(steps)) > STEP_TOLERANCE * max(1.0, abs(steps)):
            return f"{self.name} must be a multiple of {self.step:g} from {self.minimum:g}"
        return None


def int_param(
    name: str,
    label: str,
    default: int,
    minimum: int,
    maximum: int,
    description: str,
    step: int = 1,
    unit: str | None = None,
) -> ParamDef:
    return ParamDef(
        name=name,
        label=label,
        type="int",
        default=default,
        minimum=minimum,
        maximum=maximum,
        step=step,
        unit=unit,
        description=description,
    )


def float_param(
    name: str,
    label: str,
    default: float,
    minimum: float,
    maximum: float,
    step: float,
    description: str,
    unit: str | None = None,
) -> ParamDef:
    return ParamDef(
        name=name,
        label=label,
        type="float",
        default=default,
        minimum=minimum,
        maximum=maximum,
        step=step,
        unit=unit,
        description=description,
    )


def directions_param(
    default: str = "both",
    market_defaults: dict[MarketKind, ParamValue] | None = None,
    description: str = "Which trades are allowed: long only, short only, or both.",
) -> ParamDef:
    return ParamDef(
        name="directions",
        label="Directions",
        type="choice",
        default=default,
        choices=["long", "short", "both"],
        market_defaults=market_defaults,
        description=description,
    )


def validate_values(
    definitions: tuple[ParamDef, ...],
    values: Mapping[str, object] | None,
    market: MarketKind,
) -> dict[str, ParamValue]:
    if values is None:
        values = {}
    if not isinstance(values, Mapping):
        raise ParameterError(["parameters must be an object of name: value pairs"])
    names = {definition.name for definition in definitions}
    problems = [
        f"unknown parameter {name!r}" for name in sorted(map(str, values)) if name not in names
    ]
    validated: dict[str, ParamValue] = {}
    for definition in definitions:
        value = values.get(definition.name, definition.default_for(market))
        problem = definition.problem(value)
        if problem:
            problems.append(problem)
        else:
            validated[definition.name] = value
    if problems:
        raise ParameterError(problems)
    return validated
