import math
from collections.abc import Sequence

from app.engine.metrics import summarize_trades
from app.engine.results import TradeSummary
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, settle
from app.honesty.text import factor, money, split_index


def _pf_value(summary: TradeSummary) -> float:
    if summary.profit_factor is not None:
        return summary.profit_factor
    return math.inf if summary.net_pnl > 0 else 0.0


def _part(prefix: str, summary: TradeSummary) -> dict[str, float | int | None]:
    return {
        f"{prefix}_trades": summary.trade_count,
        f"{prefix}_net_pnl": summary.net_pnl,
        f"{prefix}_profit_factor": summary.profit_factor,
        f"{prefix}_win_rate_pct": summary.win_rate_pct,
        f"{prefix}_expectancy": summary.expectancy,
    }


def evaluate(
    net_pnls: Sequence[float], initial_capital: float, config: HonestyConfig
) -> CheckResult:
    cut = split_index(len(net_pnls), config.split_fraction)
    first = summarize_trades(list(net_pnls[:cut]), initial_capital)
    last = summarize_trades(list(net_pnls[cut:]), initial_capital)
    insufficient = min(first.trade_count, last.trade_count) < config.min_trades_per_split
    first_pf = _pf_value(first)
    last_pf = _pf_value(last)
    ratio = None
    if first.profit_factor is not None and last.profit_factor is not None and first_pf > 0:
        ratio = last_pf / first_pf
    first_pct = f"{config.split_fraction * 100:g}%"
    last_pct = f"{(1 - config.split_fraction) * 100:g}%"
    detail = (
        f"First {first_pct} of trades ({first.trade_count:,}): net {money(first.net_pnl)}, "
        f"profit factor {factor(first.profit_factor)}. Last {last_pct} "
        f"({last.trade_count:,}): net {money(last.net_pnl)}, profit factor "
        f"{factor(last.profit_factor)}. The split is by trade order, not by date, and the "
        "strategy rules are the same in both parts."
    )
    if last.trade_count == 0:
        status = "FAIL"
        headline = "No trades in the last part, so it cannot confirm anything"
    elif last.net_pnl <= 0 and first.net_pnl > 0:
        status = "FAIL"
        headline = f"Profitable early, then {money(last.net_pnl)} in the last {last_pct}"
    elif last.net_pnl <= 0:
        status = "FAIL"
        headline = f"The last {last_pct} of trades lose money as well"
    elif last_pf >= config.out_of_sample_min_pf_ratio * first_pf:
        status = "PASS"
        headline = f"The last {last_pct} of trades hold up: net {money(last.net_pnl)}"
    else:
        status = "WARN"
        headline = f"The last {last_pct} is profitable but weaker than the first part"
    if insufficient:
        detail += (
            f" Each part needs at least {config.min_trades_per_split} trades; this split "
            "is insufficient to judge."
        )
    return CheckResult(
        id="out_of_sample",
        status=settle(status, insufficient),
        headline=headline,
        detail=detail,
        insufficient_data=insufficient,
        measured={
            **_part("first", first),
            **_part("last", last),
            "profit_factor_ratio": ratio,
        },
        thresholds={
            "split_fraction": config.split_fraction,
            "min_profit_factor_ratio": config.out_of_sample_min_pf_ratio,
            "min_trades_per_split": config.min_trades_per_split,
        },
    )
