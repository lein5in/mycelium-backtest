import random
from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.runs.events import CheckId, CheckStatus, Stage, Verdict

SCENARIO_SEED = 20261103
BAR_COUNT = 400
FAILURE_BAR = 228


class Scenario(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"


@dataclass(frozen=True)
class Step:
    delay: float
    payload: dict[str, Any]


@dataclass(frozen=True)
class CheckOutcome:
    check_id: CheckId
    status: CheckStatus
    figure: str


SCRIPTED_CHECKS: tuple[CheckOutcome, ...] = (
    CheckOutcome("costs", "PASS", "Fees and slippage on 236 of 236 fills"),
    CheckOutcome("trade_count", "WARN", "118 trades · 82 / 36 per split"),
    CheckOutcome("without_best_trade", "PASS", "PF 1.31 → 1.18 without best trade"),
    CheckOutcome("out_of_sample", "WARN", "Out-of-sample PF 1.04 on last 30%"),
    CheckOutcome("versus_random", "PASS", "97th percentile of 1,000 random runs"),
    CheckOutcome("robustness", "FAIL", "One quarter holds 64% of profit"),
)
SCRIPTED_VERDICT: Verdict = "FRAGILE"


def _stage(stage: Stage, duration: float, details: list[str], done: str) -> Iterator[Step]:
    yield Step(0.15, {"type": "stage_started", "stage": stage})
    interval = duration / len(details)
    for index, detail in enumerate(details, start=1):
        progress = round(100 * index / len(details))
        yield Step(
            interval,
            {"type": "stage_progress", "stage": stage, "progress": progress, "detail": detail},
        )
    yield Step(0.1, {"type": "stage_done", "stage": stage, "detail": done})


def _clusters(rng: random.Random) -> list[dict[str, Any]]:
    clusters = []
    for anchor in (70, 165, 290):
        start = anchor + rng.randint(-12, 12)
        width = rng.randint(10, 22)
        low = round(rng.uniform(0.15, 0.6), 3)
        high = round(min(0.95, low + rng.uniform(0.12, 0.28)), 3)
        clusters.append(
            {
                "region": {
                    "start_bar": start,
                    "end_bar": start + width,
                    "price_low": low,
                    "price_high": high,
                },
                "fills": rng.randint(6, 18) * 2,
                "net_result": round(rng.uniform(-900, 1600), 2),
            }
        )
    return clusters


def _simulator(rng: random.Random, stop_at_bar: int | None) -> Iterator[Step]:
    yield Step(0.15, {"type": "stage_started", "stage": "SIMULATOR"})
    pending = _clusters(rng)
    ticks = 20
    trades = 0
    for tick in range(1, ticks + 1):
        bar_index = round(BAR_COUNT * tick / ticks) - 1
        if stop_at_bar is not None and bar_index >= stop_at_bar:
            return
        trades += rng.randint(4, 8)
        yield Step(
            0.2,
            {
                "type": "stage_progress",
                "stage": "SIMULATOR",
                "progress": round(100 * tick / ticks),
                "bar_index": bar_index,
                "detail": f"bar {bar_index + 1:,} / {BAR_COUNT:,} · {trades} trades",
            },
        )
        while pending and pending[0]["region"]["end_bar"] <= bar_index:
            yield Step(0.05, {"type": "trade_cluster", **pending.pop(0)})
    yield Step(
        0.1,
        {"type": "stage_done", "stage": "SIMULATOR", "detail": f"{BAR_COUNT:,} bars · 118 trades"},
    )


def _auditor() -> Iterator[Step]:
    yield Step(0.15, {"type": "stage_started", "stage": "AUDITOR"})
    for index, outcome in enumerate(SCRIPTED_CHECKS, start=1):
        yield Step(
            0.3,
            {
                "type": "stage_progress",
                "stage": "AUDITOR",
                "progress": round(100 * index / len(SCRIPTED_CHECKS)),
                "detail": f"check {index} / {len(SCRIPTED_CHECKS)}",
            },
        )
        yield Step(
            0.05,
            {
                "type": "check_done",
                "check_id": outcome.check_id,
                "status": outcome.status,
                "figure": outcome.figure,
            },
        )
    yield Step(0.1, {"type": "stage_done", "stage": "AUDITOR", "detail": "6 checks · 1 failed"})


def scripted_steps(scenario: Scenario) -> list[Step]:
    rng = random.Random(SCENARIO_SEED)
    steps: list[Step] = [Step(0.0, {"type": "run_started", "bar_count": BAR_COUNT})]
    steps += _stage(
        "DATA",
        1.2,
        ["loading candles", f"{BAR_COUNT:,} bars", "checking gaps", f"{BAR_COUNT:,} bars · 0 gaps"],
        f"{BAR_COUNT:,} bars · 0 gaps",
    )
    steps += _stage(
        "SIGNALS",
        1.4,
        ["warm-up 14 bars", "RSI(14)", "entries", "exits", "131 signals"],
        "131 signals",
    )
    if scenario is Scenario.FAILURE:
        steps += _simulator(rng, stop_at_bar=FAILURE_BAR)
        steps.append(
            Step(
                0.4,
                {
                    "type": "run_failed",
                    "stage": "SIMULATOR",
                    "message": f"The simulator stopped at bar {FAILURE_BAR + 1}: "
                    "a price gap broke the fill model. Retry the run "
                    "or pick another date range.",
                },
            )
        )
        return steps
    steps += _simulator(rng, stop_at_bar=None)
    steps += _stage("COSTS", 1.0, ["fees", "slippage", "236 fills"], "236 fills costed")
    steps += _auditor()
    steps += _stage("REPORTER", 0.9, ["equity curve", "calendar", "report"], "report ready")
    steps.append(Step(0.4, {"type": "run_done", "verdict": SCRIPTED_VERDICT}))
    return steps
