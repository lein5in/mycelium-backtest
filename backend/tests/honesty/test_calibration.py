import pytest

from tests.honesty.calibration import SCENARIOS, run_scenario

KNOWN_DISAGREEMENTS: dict[str, str] = {}


def test_at_least_ten_scenarios_cover_the_required_cases():
    names = {scenario.name for scenario in SCENARIOS}
    assert len(names) >= 10
    assert {
        "planted_edge",
        "one_lucky_trade",
        "edge_vanishes_after_costs",
        "parameter_spike",
        "too_few_trades",
        "strong_first_part_dead_last",
        "profit_in_one_period",
    } <= names
    assert sum(1 for scenario in SCENARIOS if scenario.noise) >= 3


@pytest.mark.parametrize(
    "scenario",
    [
        pytest.param(
            scenario,
            id=scenario.name,
            marks=(
                [pytest.mark.xfail(strict=True, reason=KNOWN_DISAGREEMENTS[scenario.name])]
                if scenario.name in KNOWN_DISAGREEMENTS
                else []
            ),
        )
        for scenario in SCENARIOS
    ],
)
def test_calibration_verdicts(scenario):
    report = run_scenario(scenario)
    if scenario.noise:
        assert report.verdict.id != "CREDIBLE"
    assert report.verdict.id in scenario.expected, [
        (check.id, check.status, check.insufficient_data) for check in report.checks
    ]
