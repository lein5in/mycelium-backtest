from collections.abc import Sequence
from dataclasses import dataclass

from app.engine.backtest import run_plan
from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig, CostModel
from app.engine.results import Trade
from app.engine.sessions import SessionMap
from app.engine.signals import SignalPlan
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult
from app.honesty.text import money, percent


@dataclass(frozen=True)
class CostFigures:
    trade_count: int
    gross_pnl: float
    fees: float
    slippage: float
    net_pnl: float
    net_zero_cost: float
    net_scaled_cost: float
    multiplier: float


def scaled_costs(costs: CostModel, multiplier: float) -> CostModel:
    slippage = costs.slippage.model_copy(update={"value": costs.slippage.value * multiplier})
    return costs.model_copy(
        update={
            "fee_pct": costs.fee_pct * multiplier,
            "fixed_fee": costs.fixed_fee * multiplier,
            "slippage": slippage,
        }
    )


def _net(trades: Sequence[Trade]) -> float:
    return float(sum(trade.net_pnl for trade in trades))


def measure(
    bars: BarSeries,
    sessions: SessionMap,
    plan: SignalPlan,
    config: BacktestConfig,
    name: str,
    trades: Sequence[Trade],
    multiplier: float,
) -> CostFigures:
    zero = config.model_copy(update={"costs": scaled_costs(config.costs, 0.0)})
    scaled = config.model_copy(update={"costs": scaled_costs(config.costs, multiplier)})
    zero_trades = run_plan(bars, plan, zero, name, sessions).result.trades
    scaled_trades = run_plan(bars, plan, scaled, name, sessions).result.trades
    return CostFigures(
        trade_count=len(trades),
        gross_pnl=float(sum(trade.gross_pnl for trade in trades)),
        fees=float(sum(trade.fees for trade in trades)),
        slippage=float(sum(trade.slippage_cost for trade in trades)),
        net_pnl=_net(trades),
        net_zero_cost=_net(zero_trades),
        net_scaled_cost=_net(scaled_trades),
        multiplier=multiplier,
    )


def evaluate(figures: CostFigures, config: HonestyConfig) -> CheckResult:
    total_costs = figures.fees + figures.slippage
    share = total_costs / figures.gross_pnl if figures.gross_pnl > 0 else None
    times = f"{figures.multiplier:g}x"
    measured = {
        "trade_count": figures.trade_count,
        "gross_pnl": figures.gross_pnl,
        "fees": figures.fees,
        "slippage_cost": figures.slippage,
        "total_costs": total_costs,
        "net_pnl": figures.net_pnl,
        "net_pnl_zero_cost": figures.net_zero_cost,
        "net_pnl_scaled_cost": figures.net_scaled_cost,
        "cost_multiplier": figures.multiplier,
        "cost_share_of_gross": share,
    }
    thresholds = {
        "pass_max_share": config.costs_pass_share,
        "fail_min_share": config.costs_fail_share,
        "cost_multiplier": figures.multiplier,
    }
    if figures.trade_count == 0:
        return CheckResult(
            id="costs",
            status="WARN",
            headline="No trades, so the effect of costs cannot be measured",
            detail="The run produced no trades; there is nothing for costs to act on.",
            insufficient_data=True,
            measured=measured,
            thresholds=thresholds,
        )
    detail = (
        f"Gross P&L before costs {money(figures.gross_pnl)}; fees {money(figures.fees)} and "
        f"slippage {money(figures.slippage)} leave a net of {money(figures.net_pnl)}. "
        f"Re-run with costs at {times}: net {money(figures.net_scaled_cost)}. "
        f"Re-run with no costs: net {money(figures.net_zero_cost)}."
    )
    if figures.gross_pnl <= 0:
        status = "FAIL"
        headline = "Loses money even before costs"
    elif figures.net_pnl <= 0:
        status = "FAIL"
        headline = f"Profitable before costs, not after: costs take {percent(share)} of gross"
    elif share is not None and share > config.costs_fail_share:
        status = "FAIL"
        headline = f"Costs take {percent(share)} of gross profit"
    elif figures.net_scaled_cost <= 0:
        status = "WARN"
        headline = f"Profitable at real costs, not at {times} costs"
    elif share is not None and share >= config.costs_pass_share:
        status = "WARN"
        headline = f"Costs take {percent(share)} of gross profit"
    else:
        status = "PASS"
        headline = f"Still profitable at {times} costs; costs take {percent(share)} of gross"
    return CheckResult(
        id="costs",
        status=status,
        headline=headline,
        detail=detail,
        insufficient_data=False,
        measured=measured,
        thresholds=thresholds,
    )
