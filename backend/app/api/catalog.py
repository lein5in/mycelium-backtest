from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.data.models import ProviderInfo
from app.engine.sessions import MarketKind
from app.errors import ApiError
from app.jobs.requests import LimitsDocument, limits_document
from app.strategies.base import MARKET_LABELS, StrategyMetadata
from app.strategies.registry import STRATEGY_IDS, RegistryDocument, get_strategy, registry_document

router = APIRouter(prefix="/api")


class MarketInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: MarketKind
    label: str


class MarketsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    markets: list[MarketInfo]
    providers: list[ProviderInfo]


def enabled_providers(request: Request) -> list[ProviderInfo]:
    return [info for info in request.app.state.providers if info.enabled]


@router.get("/limits")
def limits(request: Request) -> LimitsDocument:
    return limits_document(request.app.state.settings, enabled_providers(request))


@router.get("/markets")
def markets(request: Request) -> MarketsDocument:
    return MarketsDocument(
        markets=[MarketInfo(id=market, label=label) for market, label in MARKET_LABELS.items()],
        providers=enabled_providers(request),
    )


@router.get("/strategies")
def strategies() -> RegistryDocument:
    return registry_document()


@router.get("/strategies/{strategy_id}")
def strategy(strategy_id: str) -> StrategyMetadata:
    if strategy_id not in STRATEGY_IDS:
        raise ApiError("not_found", "Unknown strategy.")
    return get_strategy(strategy_id)
