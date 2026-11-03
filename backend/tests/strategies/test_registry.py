import json
import re

import pytest

from app.engine import IncompatibleMarketError, StrategySpec
from app.strategies.custom import CustomStrategyError
from app.strategies.params import ParameterError
from app.strategies.registry import (
    STRATEGY_IDS,
    RegistryDocument,
    UnknownStrategyError,
    build_spec,
    get_strategy,
    list_strategies,
    registry_document,
    validate_parameters,
)
from tests.strategies.test_custom import DONCHIAN_CUSTOM

LIBRARY_IDS = [strategy_id for strategy_id in STRATEGY_IDS if strategy_id != "custom"]
CLAIMS = re.compile(
    r"profitab|guarantee|proven|beat the market|outperform|make money|always win|risk-free|"
    r"\d+\s?%",
    re.IGNORECASE,
)


def text_of(metadata) -> str:
    parts = [metadata.name, metadata.summary, metadata.idea, metadata.works_when]
    parts += [metadata.fails_when, metadata.market_note or "", metadata.note]
    parts += [p.description + p.label for p in metadata.parameters]
    return " ".join(parts)


def test_registry_lists_the_six_strategies_in_order():
    assert STRATEGY_IDS == (
        "orb",
        "vwap_mean_reversion",
        "gap_fade",
        "donchian_breakout",
        "rsi_mean_reversion",
        "custom",
    )
    assert [m.id for m in list_strategies()] == list(STRATEGY_IDS)


@pytest.mark.parametrize("strategy_id", STRATEGY_IDS)
def test_every_strategy_has_complete_plain_metadata(strategy_id):
    metadata = get_strategy(strategy_id)
    for field in ("name", "summary", "idea", "works_when", "fails_when", "note"):
        assert len(getattr(metadata, field)) > 20 or field == "name"
    assert metadata.markets and metadata.timeframes
    assert "does not predict future results" in metadata.note
    assert metadata.default_risk.max_trades_per_session == 1
    assert not CLAIMS.search(text_of(metadata)), CLAIMS.search(text_of(metadata))
    for parameter in metadata.parameters:
        assert parameter.description and parameter.label
        if parameter.type == "choice":
            assert parameter.choices and parameter.default in parameter.choices
        else:
            assert None not in (parameter.minimum, parameter.maximum, parameter.step)
            assert parameter.minimum <= parameter.default <= parameter.maximum


@pytest.mark.parametrize("strategy_id", LIBRARY_IDS)
def test_defaults_validate_and_build_on_every_supported_market(strategy_id):
    metadata = get_strategy(strategy_id)
    assert metadata.parameters
    for market in metadata.markets:
        values = validate_parameters(strategy_id, None, market)
        assert set(values) == {p.name for p in metadata.parameters}
        spec = build_spec(strategy_id, values, market)
        assert isinstance(spec, StrategySpec) and market in spec.markets
        assert StrategySpec.model_validate_json(spec.model_dump_json()) == spec
        assert all(rules.stop for rules in (spec.long, spec.short) if rules is not None)


def test_gap_fade_is_stocks_only_and_explains_why():
    metadata = get_strategy("gap_fade")
    assert metadata.markets == ["us_equity"]
    with pytest.raises(IncompatibleMarketError, match="no overnight gap"):
        build_spec("gap_fade", None, "crypto_24x7")
    with pytest.raises(IncompatibleMarketError):
        validate_parameters("gap_fade", None, "crypto_24x7")


def test_custom_goes_through_the_registry():
    spec = build_spec("custom", DONCHIAN_CUSTOM, "crypto_24x7")
    assert spec.name == "My channel breakout"
    assert validate_parameters("custom", DONCHIAN_CUSTOM, "us_equity")["name"] == spec.name
    assert get_strategy("custom").limits["max_entry_conditions"] == 6
    with pytest.raises(CustomStrategyError):
        build_spec("custom", {"name": "x"}, "crypto_24x7")


def test_unknown_ids_and_bad_parameters_are_rejected():
    with pytest.raises(UnknownStrategyError, match="known strategies"):
        get_strategy("martingale")
    with pytest.raises(UnknownStrategyError):
        build_spec("__import__", None, "us_equity")
    with pytest.raises(ParameterError, match="unknown parameter"):
        validate_parameters("orb", {"leverage": 10}, "us_equity")
    with pytest.raises(ParameterError, match="between"):
        build_spec("donchian_breakout", {"entry_lookback": 10_000}, "us_equity")


def test_registry_serialises_to_json_and_round_trips():
    document = registry_document()
    payload = json.loads(document.model_dump_json())
    assert payload["schema_version"] == 1
    assert [s["id"] for s in payload["strategies"]] == list(STRATEGY_IDS)
    assert all(s["schema_version"] == 1 for s in payload["strategies"])
    assert RegistryDocument.model_validate_json(document.model_dump_json()) == document
    rsi = next(s for s in payload["strategies"] if s["id"] == "rsi_mean_reversion")
    directions = next(p for p in rsi["parameters"] if p["name"] == "directions")
    assert directions["market_defaults"] == {"us_equity": "long", "crypto_24x7": "both"}
