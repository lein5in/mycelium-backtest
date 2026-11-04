from collections.abc import Sequence

from app.engine.metrics import summarize_trades, without_best_trade
from app.engine.results import Trade
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, settle
from app.honesty.text import factor, money, percent


def evaluate(trades: Sequence[Trade], initial_capital: float, config: HonestyConfig) -> CheckResult:
    pnls = [trade.net_pnl for trade in trades]
    full = summarize_trades(pnls, initial_capital)
    rest = without_best_trade(trades, initial_capital)
    best = max(pnls) if pnls else None
    share = best / full.net_pnl if best is not None and full.net_pnl > 0 else None
    insufficient = len(pnls) < config.min_trades
    measured = {
        "trade_count": len(pnls),
        "best_trade_pnl": best,
        "net_pnl": full.net_pnl,
        "profit_factor": full.profit_factor,
        "net_pnl_without_best": rest.net_pnl,
        "profit_factor_without_best": rest.profit_factor,
        "best_trade_share_of_net": share,
    }
    thresholds = {
        "min_profit_factor": config.best_trade_min_profit_factor,
        "max_best_share": config.best_trade_max_share,
        "min_trades": config.min_trades,
    }
    if best is None:
        return CheckResult(
            id="without_best_trade",
            status="FAIL",
            headline="No trades, so there is no result to test",
            detail="The run produced no trades.",
            insufficient_data=True,
            measured=measured,
            thresholds=thresholds,
        )
    pf_rest = rest.profit_factor
    pf_ok = pf_rest is None or pf_rest >= config.best_trade_min_profit_factor
    detail = (
        f"The best trade made {money(best)}"
        + (f", {percent(share)} of the net P&L of {money(full.net_pnl)}" if share else "")
        + f". Without it the net P&L is {money(rest.net_pnl)} and the profit factor "
        f"{factor(pf_rest)} (n/a means no losing trade)."
    )
    if rest.net_pnl <= 0:
        status = "FAIL"
        headline = f"Without the best trade the result is {money(rest.net_pnl)}"
    elif not pf_ok:
        status = "WARN"
        headline = f"Without the best trade the profit factor drops to {factor(pf_rest)}"
    elif share is not None and share > config.best_trade_max_share:
        status = "WARN"
        headline = f"The best trade carries {percent(share)} of the net P&L"
    else:
        status = "PASS"
        headline = f"Still profitable without the best trade: {money(rest.net_pnl)}"
    if insufficient:
        detail += f" Fewer than {config.min_trades} trades: the sample is too small to judge."
    return CheckResult(
        id="without_best_trade",
        status=settle(status, insufficient),
        headline=headline,
        detail=detail,
        insufficient_data=insufficient,
        measured=measured,
        thresholds=thresholds,
    )
