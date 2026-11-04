import json

import pytest
from jsonschema import Draft202012Validator

from app.engine import run_backtest
from app.honesty.config import HonestyConfig
from app.honesty.contracts import SAMPLE_PATH, SCHEMA_PATH, sample_text, schema_text
from app.honesty.model import CheckResult
from app.honesty.report import HonestyInput, build_report
from app.honesty.sweep import SweepRequest
from app.honesty.verdict import decide
from app.runs.events import CHECK_IDS
from app.strategies.registry import build_spec, validate_parameters
from tests.json_compare import assert_json_text_close
from tests.strategies.helpers import CRYPTO, random_crypto


def check(check_id, status, insufficient=False):
    return CheckResult(
        id=check_id,
        status=status,
        headline="x",
        detail="x",
        insufficient_data=insufficient,
        measured={},
        thresholds={},
    )


def checks(**overrides):
    statuses = {check_id: ("PASS", False) for check_id in CHECK_IDS}
    for check_id, value in overrides.items():
        statuses[check_id] = value if isinstance(value, tuple) else (value, False)
    return [check(check_id, *statuses[check_id]) for check_id in CHECK_IDS]


@pytest.mark.parametrize(
    ("overrides", "verdict", "rule"),
    [
        ({}, "CREDIBLE", "credible"),
        ({"robustness": "WARN"}, "CREDIBLE", "credible"),
        ({"robustness": "WARN", "out_of_sample": "WARN"}, "FRAGILE", "otherwise"),
        ({"out_of_sample": "WARN"}, "FRAGILE", "otherwise"),
        ({"costs": "WARN"}, "CREDIBLE", "credible"),
        ({"costs": "FAIL"}, "NOT_CREDIBLE", "costs_fail"),
        ({"versus_random": "FAIL"}, "NOT_CREDIBLE", "random_fail"),
        ({"trade_count": "FAIL"}, "NOT_CREDIBLE", "trade_count_fail"),
        ({"robustness": "FAIL", "out_of_sample": "FAIL"}, "NOT_CREDIBLE", "two_fails"),
        ({"robustness": "FAIL"}, "FRAGILE", "otherwise"),
        ({"without_best_trade": "FAIL"}, "FRAGILE", "otherwise"),
        ({"versus_random": "WARN"}, "FRAGILE", "otherwise"),
        ({"out_of_sample": ("WARN", True)}, "FRAGILE", "otherwise"),
        ({"trade_count": ("WARN", True)}, "FRAGILE", "otherwise"),
        ({"robustness": ("PASS", True)}, "FRAGILE", "otherwise"),
        ({"trade_count": ("FAIL", True), "costs": "FAIL"}, "NOT_CREDIBLE", "costs_fail"),
    ],
)
def test_verdict_rules(overrides, verdict, rule):
    result = decide(checks(**overrides))
    assert result.id == verdict
    assert result.rule == rule
    assert next(r.id for r in result.rules if r.matched) == rule
    assert result.label == {"CREDIBLE": "Credible", "FRAGILE": "Fragile"}.get(
        verdict, "Not credible"
    )
    assert "Fragile otherwise" in result.sentence


def test_committed_schema_matches_models():
    assert SCHEMA_PATH.read_text(encoding="utf-8") == schema_text()


def test_committed_sample_matches_generator_and_validates():
    assert_json_text_close(SAMPLE_PATH.read_text(encoding="utf-8"), sample_text())
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(json.loads(SAMPLE_PATH.read_text(encoding="utf-8")))


def test_schema_rejects_unknown_check_status():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    report = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    report["checks"][0]["status"] = "MAYBE"
    assert not Draft202012Validator(schema).is_valid(report)


def run_inputs(strategy_id="donchian_breakout", sweep=True):
    bars = random_crypto(2_500, 8)
    params = validate_parameters("donchian_breakout", {"entry_lookback": 10}, "crypto_24x7")
    spec = build_spec("donchian_breakout", params, "crypto_24x7")
    output = run_backtest(bars, spec, CRYPTO)
    request = SweepRequest("donchian_breakout", params, "crypto_24x7") if sweep else None
    return HonestyInput(bars, spec, CRYPTO, output, strategy_id, params, request)


def test_progress_is_called_once_per_check_in_contract_order():
    calls = []
    report = build_report(
        run_inputs(),
        HonestyConfig(random_draws=100),
        progress=lambda check_id, status: calls.append((check_id, status)),
    )
    assert [check_id for check_id, _ in calls] == list(CHECK_IDS)
    assert calls == [(c.id, c.status) for c in report.checks]
    assert [c.id for c in report.checks] == list(CHECK_IDS)


def test_report_is_deterministic_and_carries_its_configuration():
    config = HonestyConfig(random_draws=150, random_seed=3)
    first = build_report(run_inputs(), config, clock=lambda: 0.0)
    second = build_report(run_inputs(), config, clock=lambda: 0.0)
    assert first == second
    assert first.config == config
    assert first.random_entries.draws == 150
    assert first.sweep is not None
    assert first.robustness.parameters.status != "not_run"
    assert any("do not predict" in line for line in first.assumptions)
    assert any("overlap" in line for line in first.assumptions)
    for result in first.checks:
        assert len(result.headline) <= 120
        if result.insufficient_data:
            assert result.status != "PASS"


def test_parameter_part_not_run_without_sweep_and_said_in_detail():
    report = build_report(run_inputs(sweep=False), HonestyConfig(random_draws=100))
    assert report.sweep is None
    assert report.robustness.parameters.status == "not_run"
    robustness = report.checks[-1]
    assert robustness.status == report.robustness.period.status
    assert "periods only" in robustness.detail
    custom = build_report(run_inputs("custom", sweep=False), HonestyConfig(random_draws=100))
    assert "custom strategy declares no sweepable" in custom.robustness.parameters.reason


def test_report_without_trades_is_not_credible():
    bars = random_crypto(300, 1)
    params = validate_parameters(
        "donchian_breakout", {"entry_lookback": 500, "directions": "long"}, "crypto_24x7"
    )
    spec = build_spec("donchian_breakout", params, "crypto_24x7")
    output = run_backtest(bars, spec, CRYPTO)
    assert output.result.trades == []
    report = build_report(
        HonestyInput(bars, spec, CRYPTO, output, "donchian_breakout", params),
        HonestyConfig(random_draws=100),
    )
    assert report.verdict.id == "NOT_CREDIBLE"
    assert all(c.insufficient_data for c in report.checks)
    assert all(c.status != "PASS" for c in report.checks)
    assert report.random_entries.histogram is None
