from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, ParameterPart, PeriodPart, Robustness, worse
from app.honesty.text import money, percent

PERIOD_HEADLINES = {
    "PASS": "Profit is spread across periods",
    "WARN": "Profit leans on one period",
    "FAIL": "Profit depends on one period",
}
PARAMETER_HEADLINES = {
    "PASS": "nearby parameters also work",
    "WARN": "nearby parameters are mixed",
    "FAIL": "nearby parameters do not hold up",
}


def _period_text(period: PeriodPart) -> str:
    if not period.blocks:
        return "No trades to cut into periods."
    nets = ", ".join(money(block.net_pnl) for block in period.blocks)
    text = (
        f"Trades cut into {len(period.blocks)} equal blocks by trade count, in time order; "
        f"net P&L per block: {nets}. Positive blocks: {percent(period.positive_fraction)}."
    )
    if period.total_net_pnl <= 0:
        text += " The total is not positive, so there is no profit to spread."
    else:
        text += f" Largest block share of the total profit: {percent(period.max_share)}."
    if period.insufficient_data:
        text += " Too few trades for a reliable period comparison."
    return text


def evaluate(
    period: PeriodPart, parameters: ParameterPart, config: HonestyConfig
) -> tuple[CheckResult, Robustness]:
    status = period.status
    headline = PERIOD_HEADLINES[period.status]
    detail = _period_text(period)
    insufficient = period.insufficient_data
    if parameters.status == "not_run":
        detail += f" Parameter sweep not run: {parameters.reason} This check uses periods only."
    else:
        status = worse(status, parameters.status)
        insufficient = insufficient or parameters.insufficient_data
        headline = f"{headline}; {PARAMETER_HEADLINES[parameters.status]}"
        detail += f" Parameter sweep: {parameters.reason}"
    if insufficient and status == "PASS":
        status = "WARN"
    if period.total_net_pnl <= 0 and period.blocks:
        headline = "No overall profit to spread across periods"
    check = CheckResult(
        id="robustness",
        status=status,
        headline=headline,
        detail=detail,
        insufficient_data=insufficient,
        measured={
            "period_status": period.status,
            "period_blocks": len(period.blocks),
            "period_max_share": period.max_share,
            "period_positive_fraction": period.positive_fraction,
            "parameter_status": parameters.status,
        },
        thresholds={
            "period_blocks": config.period_blocks,
            "period_fail_share": config.period_fail_share,
            "period_warn_share": config.period_warn_share,
            "period_min_positive_fraction": config.period_min_positive_fraction,
            "sweep_pass_neighbours": config.sweep_pass_neighbours,
            "sweep_warn_neighbours": config.sweep_warn_neighbours,
            "sweep_spike_ratio": config.sweep_spike_ratio,
        },
    )
    return check, Robustness(period=period, parameters=parameters)
