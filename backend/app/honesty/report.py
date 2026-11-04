import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import JsonValue

from app.engine.backtest import BacktestOutput
from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig
from app.engine.signals import compile_spec
from app.engine.spec import StrategySpec
from app.honesty import (
    best_trade,
    calendar,
    costs,
    out_of_sample,
    periods,
    random_entries,
    robustness,
    trade_count,
    verdict,
)
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, HonestyReport, RunSummary, SweepResult
from app.honesty.sweep import Clock, SweepError, SweepRequest, not_run, parameter_part, run_sweep

CheckProgress = Callable[[str, str], None]
CheckListener = Callable[[CheckResult], None]

NO_SWEEP_REASON = "the caller chose not to sweep parameters for this run."
CUSTOM_REASON = "the custom strategy declares no sweepable parameters."


@dataclass(frozen=True)
class HonestyInput:
    bars: BarSeries
    spec: StrategySpec
    config: BacktestConfig
    output: BacktestOutput
    strategy_id: str
    parameters: Mapping[str, JsonValue]
    sweep: SweepRequest | None = None


def assumptions(config: HonestyConfig, swept: bool) -> list[str]:
    lines = [
        "Past results do not predict future results. This report describes one backtest on "
        "one data set.",
        "Costs are modelled from the fees and slippage you set; real fills can be worse.",
        f"The costs check re-runs the same rules with no costs and with costs at "
        f"{config.cost_multiplier:g}x.",
        f"The out-of-sample check splits trades in time order, "
        f"{config.split_fraction * 100:g}/{(1 - config.split_fraction) * 100:g}; the rules "
        "were not re-fitted on the first part, so this is a consistency check, not a true "
        "walk-forward test.",
        f"Random entries: {config.random_draws:,} draws with seed {config.random_seed}, the "
        "same number of trades and holding durations, random entry bars and directions, "
        "trades kept in their original order. Random trades have no stop or target, because "
        "those come from the signal logic being tested; they exit after the same number of "
        "bars as the real trade they mirror.",
        "Random trades of one draw may overlap in time, unlike the real run, which holds one "
        "position at a time.",
        "Random trades use the run's costs; with fixed-fraction sizing on the initial capital "
        "they use the same sizing rule, otherwise the notional of the real trade they mirror.",
        f"Period robustness cuts trades into up to {config.period_blocks} equal blocks by "
        "trade count, not by calendar time.",
        f"A check with fewer than {config.min_trades} trades, or fewer than "
        f"{config.min_trades_per_split} per split, is flagged as lacking data and never "
        "passes.",
    ]
    if swept:
        lines.append(
            "The parameter sweep re-runs the full engine for each setting on the same data; "
            "a profitable neighbourhood is evidence of stability, not of future profit."
        )
    return lines


def build_report(
    inputs: HonestyInput,
    config: HonestyConfig | None = None,
    progress: CheckProgress | None = None,
    clock: Clock = time.perf_counter,
    on_check: CheckListener | None = None,
) -> HonestyReport:
    config = config or HonestyConfig()
    bars = inputs.bars
    result = inputs.output.result
    sessions = inputs.output.sessions
    trades = result.trades
    capital = inputs.config.initial_capital
    pnls = [trade.net_pnl for trade in trades]
    checks: list[CheckResult] = []

    def done(check: CheckResult) -> None:
        checks.append(check)
        if progress is not None:
            progress(check.id, check.status)
        if on_check is not None:
            on_check(check)

    plan = compile_spec(inputs.spec, bars, sessions)
    figures = costs.measure(
        bars, sessions, plan, inputs.config, inputs.spec.name, trades, config.cost_multiplier
    )
    done(costs.evaluate(figures, config))
    done(trade_count.evaluate(len(trades), config))
    done(best_trade.evaluate(trades, capital, config))
    done(out_of_sample.evaluate(pnls, capital, config))
    random_check, random_summary = random_entries.evaluate(
        bars, sessions, trades, inputs.spec, result.warmup_bars, inputs.config, config
    )
    done(random_check)

    period = periods.evaluate(pnls, [trade.exit_time for trade in trades], config)
    sweep: SweepResult | None = None
    if inputs.sweep is None:
        reason = CUSTOM_REASON if inputs.strategy_id == "custom" else NO_SWEEP_REASON
        parameters = not_run(reason)
    else:
        try:
            sweep = run_sweep(inputs.sweep, bars, sessions, inputs.config, config, clock)
            parameters = parameter_part(sweep, config)
        except SweepError as error:
            parameters = not_run(str(error))
    robustness_check, robustness_detail = robustness.evaluate(period, parameters, config)
    done(robustness_check)

    return HonestyReport(
        run=RunSummary(
            strategy_id=inputs.strategy_id,
            strategy_name=inputs.spec.name,
            parameters=dict(inputs.parameters),
            market=result.market,
            timeframe=result.timeframe,
            first_bar=result.first_bar,
            last_bar=result.last_bar,
            bar_count=result.bar_count,
            trade_count=len(trades),
        ),
        checks=checks,
        verdict=verdict.decide(checks),
        config=config,
        random_entries=random_summary,
        robustness=robustness_detail,
        sweep=sweep,
        calendar=calendar.build(trades, sessions, inputs.config.session),
        assumptions=assumptions(config, sweep is not None),
    )
