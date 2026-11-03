from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.engine.models import RiskLimits
from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies import (
    donchian_breakout,
    gap_fade,
    orb,
    rsi_mean_reversion,
    vwap_mean_reversion,
)
from app.strategies.base import (
    METADATA_SCHEMA_VERSION,
    LibraryStrategy,
    StrategyId,
    StrategyMetadata,
    check_market,
)
from app.strategies.custom import LIMITS, build_custom, parse_description
from app.strategies.params import ParamValue

LIBRARY: dict[str, LibraryStrategy] = {
    strategy.id: strategy
    for strategy in (
        orb.STRATEGY,
        vwap_mean_reversion.STRATEGY,
        gap_fade.STRATEGY,
        donchian_breakout.STRATEGY,
        rsi_mean_reversion.STRATEGY,
    )
}
STRATEGY_IDS: tuple[StrategyId, ...] = (
    "orb",
    "vwap_mean_reversion",
    "gap_fade",
    "donchian_breakout",
    "rsi_mean_reversion",
    "custom",
)

CUSTOM_METADATA = StrategyMetadata(
    id="custom",
    name="Custom strategy",
    summary="Your own rules, built from a fixed list of prices, indicators and comparisons.",
    idea=(
        "Combine up to six entry conditions with AND for longs and for shorts, each comparing "
        "a price, an indicator or a constant. Every rule set needs a stop; a target, exit "
        "conditions and a time exit are optional. The description is data, never code."
    ),
    works_when=(
        "You want to test a specific, simple idea with the same engine, costs and honesty "
        "checks as the library strategies."
    ),
    fails_when=(
        "Rules are tuned until they fit one period of data; many conditions and parameters "
        "make that easy and the result then says little about other periods."
    ),
    markets=["us_equity", "crypto_24x7"],
    market_note="You choose the markets the description supports; runs on other markets fail.",
    timeframes=["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
    parameters=[],
    default_risk=RiskLimits(),
    limits=LIMITS,
)


class UnknownStrategyError(KeyError):
    def __init__(self, strategy_id: object) -> None:
        known = ", ".join(STRATEGY_IDS)
        super().__init__(f"unknown strategy {strategy_id!r}; known strategies: {known}")


class RegistryDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = METADATA_SCHEMA_VERSION
    strategies: list[StrategyMetadata]


def _library(strategy_id: str) -> LibraryStrategy | None:
    if strategy_id not in STRATEGY_IDS:
        raise UnknownStrategyError(strategy_id)
    return LIBRARY.get(strategy_id)


def list_strategies() -> list[StrategyMetadata]:
    return [get_strategy(strategy_id) for strategy_id in STRATEGY_IDS]


def get_strategy(strategy_id: str) -> StrategyMetadata:
    strategy = _library(strategy_id)
    return CUSTOM_METADATA if strategy is None else strategy.metadata()


def validate_parameters(
    strategy_id: str, parameters: Mapping[str, object] | object | None, market: MarketKind
) -> dict[str, ParamValue] | dict[str, object]:
    strategy = _library(strategy_id)
    if strategy is None:
        description = parse_description(parameters)
        check_market("This custom strategy", tuple(description.markets), market, None)
        return description.model_dump()
    return strategy.validate(parameters, market)


def build_spec(
    strategy_id: str, parameters: Mapping[str, object] | object | None, market: MarketKind
) -> StrategySpec:
    strategy = _library(strategy_id)
    if strategy is None:
        return build_custom(parameters, market)
    return strategy.spec(parameters, market)


def registry_document() -> RegistryDocument:
    return RegistryDocument(strategies=list_strategies())


__all__ = [
    "STRATEGY_IDS",
    "RegistryDocument",
    "UnknownStrategyError",
    "build_spec",
    "get_strategy",
    "list_strategies",
    "registry_document",
    "validate_parameters",
]
