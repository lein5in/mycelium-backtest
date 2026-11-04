from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.honesty.model import CheckResult, VerdictResult, VerdictRule
from app.runs.events import Verdict

LABELS: dict[Verdict, str] = {
    "CREDIBLE": "Credible",
    "FRAGILE": "Fragile",
    "NOT_CREDIBLE": "Not credible",
}
SENTENCE = (
    "Not credible if the costs, random-entry or trade-count check fails, or if two or more "
    "checks fail. Credible only if no check fails, at most one warns, the out-of-sample and "
    "random-entry checks pass and no check lacks data. Fragile otherwise."
)

Predicate = Callable[[dict[str, CheckResult]], bool]


@dataclass(frozen=True)
class Rule:
    id: str
    verdict: Verdict
    description: str
    test: Predicate


def _fails(checks: dict[str, CheckResult]) -> int:
    return sum(1 for check in checks.values() if check.status == "FAIL")


def _warns(checks: dict[str, CheckResult]) -> int:
    return sum(1 for check in checks.values() if check.status == "WARN")


RULES: tuple[Rule, ...] = (
    Rule(
        "costs_fail",
        "NOT_CREDIBLE",
        "The costs check fails.",
        lambda c: c["costs"].status == "FAIL",
    ),
    Rule(
        "random_fail",
        "NOT_CREDIBLE",
        "The comparison with random entries fails.",
        lambda c: c["versus_random"].status == "FAIL",
    ),
    Rule(
        "trade_count_fail",
        "NOT_CREDIBLE",
        "The trade-count check fails.",
        lambda c: c["trade_count"].status == "FAIL",
    ),
    Rule(
        "two_fails",
        "NOT_CREDIBLE",
        "Two or more checks fail.",
        lambda c: _fails(c) >= 2,
    ),
    Rule(
        "credible",
        "CREDIBLE",
        "No check fails, at most one warns, the out-of-sample and random-entry checks pass and "
        "no check lacks data.",
        lambda c: (
            _fails(c) == 0
            and _warns(c) <= 1
            and c["out_of_sample"].status == "PASS"
            and c["versus_random"].status == "PASS"
            and not any(check.insufficient_data for check in c.values())
        ),
    ),
    Rule("otherwise", "FRAGILE", "Any other combination.", lambda c: True),
)


def decide(checks: Sequence[CheckResult]) -> VerdictResult:
    by_id = {check.id: check for check in checks}
    matches = [rule.test(by_id) for rule in RULES]
    winner = RULES[matches.index(True)]
    return VerdictResult(
        id=winner.verdict,
        label=LABELS[winner.verdict],
        rule=winner.id,
        sentence=SENTENCE,
        rules=[
            VerdictRule(
                id=rule.id,
                verdict=rule.verdict,
                description=rule.description,
                matched=matched,
            )
            for rule, matched in zip(RULES, matches, strict=True)
        ],
    )
