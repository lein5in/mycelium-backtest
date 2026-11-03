from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.engine.backtest import IncompatibleMarketError
from app.engine.bars import Timeframe
from app.engine.models import RiskLimits
from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.params import ParamDef, ParameterError, ParamValue, validate_values

METADATA_SCHEMA_VERSION = 1
RESULTS_NOTE = (
    "Results depend on the data, the period, the costs and the parameters you choose. "
    "A backtest describes the past; it does not predict future results."
)
MARKET_LABELS: dict[MarketKind, str] = {
    "us_equity": "US stocks and ETFs",
    "crypto_24x7": "crypto (24/7)",
}

StrategyId = Literal[
    "orb",
    "vwap_mean_reversion",
    "gap_fade",
    "donchian_breakout",
    "rsi_mean_reversion",
    "custom",
]
Builder = Callable[[dict[str, ParamValue], MarketKind], StrategySpec]
CrossCheck = Callable[[dict[str, ParamValue]], list[str]]


class StrategyMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = METADATA_SCHEMA_VERSION
    id: StrategyId
    name: str
    summary: str
    idea: str
    works_when: str
    fails_when: str
    markets: list[MarketKind]
    market_note: str | None = None
    timeframes: list[Timeframe]
    parameters: list[ParamDef]
    default_risk: RiskLimits
    limits: dict[str, int] | None = None
    note: str = RESULTS_NOTE


def no_cross_check(values: dict[str, ParamValue]) -> list[str]:
    return []


def check_market(name: str, markets: tuple[MarketKind, ...], market: str, note: str | None):
    if market not in markets:
        supported = " and ".join(MARKET_LABELS[m] for m in markets)
        message = f"{name} supports {supported} only; {market!r} is not supported."
        if note:
            message = f"{message} {note}"
        raise IncompatibleMarketError(message)


@dataclass(frozen=True)
class LibraryStrategy:
    id: StrategyId
    name: str
    summary: str
    idea: str
    works_when: str
    fails_when: str
    markets: tuple[MarketKind, ...]
    timeframes: tuple[Timeframe, ...]
    parameters: tuple[ParamDef, ...]
    build: Builder
    cross_check: CrossCheck = no_cross_check
    market_note: str | None = None
    default_risk: RiskLimits = field(default_factory=RiskLimits)

    def metadata(self) -> StrategyMetadata:
        return StrategyMetadata(
            id=self.id,
            name=self.name,
            summary=self.summary,
            idea=self.idea,
            works_when=self.works_when,
            fails_when=self.fails_when,
            markets=list(self.markets),
            market_note=self.market_note,
            timeframes=list(self.timeframes),
            parameters=list(self.parameters),
            default_risk=self.default_risk,
        )

    def validate(
        self, values: Mapping[str, object] | None, market: MarketKind
    ) -> dict[str, ParamValue]:
        check_market(self.name, self.markets, market, self.market_note)
        validated = validate_values(self.parameters, values, market)
        problems = self.cross_check(validated)
        if problems:
            raise ParameterError(problems)
        return validated

    def spec(self, values: Mapping[str, object] | None, market: MarketKind) -> StrategySpec:
        return self.build(self.validate(values, market), market)
