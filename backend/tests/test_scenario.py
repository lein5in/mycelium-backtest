from datetime import UTC, datetime

import pytest

from app.runs.events import CHECK_IDS, STAGES
from app.runs.scenario import SCRIPTED_CHECKS, Scenario, scripted_steps
from app.runs.stream import materialise

STARTED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def events_for(scenario: Scenario):
    return [event for _, event in materialise(scripted_steps(scenario), "r1", STARTED_AT)]


def test_scripted_checks_cover_every_check_once() -> None:
    assert tuple(outcome.check_id for outcome in SCRIPTED_CHECKS) == CHECK_IDS


def test_success_is_deterministic() -> None:
    first = [event.model_dump() for event in events_for(Scenario.SUCCESS)]
    second = [event.model_dump() for event in events_for(Scenario.SUCCESS)]
    assert first == second


def test_success_lasts_about_twelve_seconds_at_speed_one() -> None:
    total = sum(step.delay for step in scripted_steps(Scenario.SUCCESS))
    assert 11.0 <= total <= 13.0


def test_success_order_and_completeness() -> None:
    events = events_for(Scenario.SUCCESS)
    types = [event.type for event in events]
    assert types[0] == "run_started"
    assert types[-1] == "run_done"
    assert types.count("run_done") == 1
    assert "run_failed" not in types
    started = [event.stage for event in events if event.type == "stage_started"]
    done = [event.stage for event in events if event.type == "stage_done"]
    assert tuple(started) == STAGES
    assert tuple(done) == STAGES
    for stage in STAGES:
        indices = [i for i, event in enumerate(events) if getattr(event, "stage", None) == stage]
        assert events[indices[0]].type == "stage_started"
        assert events[indices[-1]].type == "stage_done"
        progress = [events[i].progress for i in indices if events[i].type == "stage_progress"]
        assert progress == sorted(progress)
        assert progress[-1] == 100
    checks = [event.check_id for event in events if event.type == "check_done"]
    assert tuple(checks) == CHECK_IDS
    assert sum(1 for event in events if event.type == "trade_cluster") >= 1


def test_stages_never_overlap() -> None:
    active = None
    for event in events_for(Scenario.SUCCESS):
        if event.type == "stage_started":
            assert active is None
            active = event.stage
        elif event.type in ("stage_progress", "stage_done"):
            assert event.stage == active
            if event.type == "stage_done":
                active = None
    assert active is None


def test_clusters_never_lead_the_simulated_bar() -> None:
    last_bar = -1
    for event in events_for(Scenario.SUCCESS):
        if event.type == "stage_progress" and event.bar_index is not None:
            last_bar = event.bar_index
        if event.type == "trade_cluster":
            assert event.region.end_bar <= last_bar


def test_checks_happen_inside_auditor_stage() -> None:
    active = None
    for event in events_for(Scenario.SUCCESS):
        if event.type == "stage_started":
            active = event.stage
        if event.type == "check_done":
            assert active == "AUDITOR"


def test_failure_ends_with_run_failed_and_no_run_done() -> None:
    events = events_for(Scenario.FAILURE)
    types = [event.type for event in events]
    assert types[-1] == "run_failed"
    assert "run_done" not in types
    assert types.count("run_failed") == 1
    failed = events[-1]
    assert failed.stage == "SIMULATOR"
    assert "Traceback" not in failed.message
    assert "check_done" not in types


@pytest.mark.parametrize("scenario", list(Scenario))
def test_seq_strictly_increasing_and_timestamps_monotonic(scenario: Scenario) -> None:
    events = events_for(scenario)
    seqs = [event.seq for event in events]
    assert seqs == list(range(len(events)))
    stamps = [event.ts for event in events]
    assert stamps == sorted(stamps)
    assert all(event.run_id == "r1" and event.schema_version == 2 for event in events)
