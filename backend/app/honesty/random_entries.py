from collections.abc import Sequence

import numpy as np

from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig, FixedFraction
from app.engine.results import Trade
from app.engine.sessions import SessionMap
from app.engine.spec import StrategySpec
from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, Histogram, RandomEntries, settle
from app.honesty.text import money, plural
from app.runs.events import CheckStatus

HEADLINES = {
    "PASS": "Beats {percentile:.0f}% of random-entry runs",
    "WARN": "Beats {percentile:.0f}% of random-entry runs: not clearly better",
    "FAIL": "Beats only {percentile:.0f}% of random-entry runs",
}
SIDE_TEXT = {(1,): "long only", (-1,): "short only", (1, -1): "long or short at random"}


def allowed_sides(spec: StrategySpec) -> np.ndarray:
    sides = []
    if spec.long is not None:
        sides.append(1)
    if spec.short is not None:
        sides.append(-1)
    return np.array(sides, dtype=np.int64)


def eligible_entries(
    sessions: SessionMap, warmup: int, holding: int, same_session: bool
) -> np.ndarray:
    size = sessions.size
    first = max(warmup + 1, 1)
    last = size - holding
    if last < first:
        return np.empty(0, dtype=np.int64)
    entries = np.arange(first, last + 1, dtype=np.int64)
    if same_session:
        ordinal = sessions.ordinal
        entries = entries[ordinal[entries - 1] == ordinal[entries + holding - 1]]
    return entries


def _quantities(
    trades: Sequence[Trade], fills: np.ndarray, config: BacktestConfig, columns: np.ndarray
) -> np.ndarray:
    costs = config.costs
    fee_rate = costs.fee_pct / 100.0
    if isinstance(config.sizing, FixedFraction) and not config.compounding:
        budget = config.initial_capital * config.sizing.fraction - costs.fixed_fee
        quantity = np.maximum(budget, 0.0) / (fills * (1.0 + fee_rate))
    else:
        notional = np.array([trades[i].entry_price * trades[i].quantity for i in columns])
        quantity = notional[np.newaxis, :] / fills
    step = config.instrument.quantity_step
    if step is not None:
        quantity = np.floor(quantity / step + 1e-9) * step
    return quantity


def _slip(prices: np.ndarray, config: BacktestConfig) -> np.ndarray:
    slippage = config.costs.slippage
    if slippage.unit == "ticks":
        return np.full(prices.shape, slippage.value * config.instrument.tick_size)
    return prices * slippage.value / 10_000.0


def simulate_draws(
    bars: BarSeries,
    sessions: SessionMap,
    trades: Sequence[Trade],
    spec: StrategySpec,
    warmup: int,
    config: BacktestConfig,
    draws: int,
    seed: int,
) -> tuple[np.ndarray, dict[str, np.ndarray], int]:
    rng = np.random.default_rng(seed)
    sides = allowed_sides(spec)
    same_session = spec.time_exit.session_end
    durations = np.array([max(1, trade.bars_held) for trade in trades], dtype=np.int64)
    totals = np.zeros(draws, dtype=np.float64)
    entries_all = np.zeros((draws, durations.size), dtype=np.int64)
    sides_all = np.zeros((draws, durations.size), dtype=np.int64)
    unplaced = 0
    fee_rate = config.costs.fee_pct / 100.0
    fixed_fee = config.costs.fixed_fee
    for holding in np.unique(durations).tolist():
        columns = np.flatnonzero(durations == holding)
        eligible = eligible_entries(sessions, warmup, holding, same_session)
        if eligible.size == 0:
            unplaced += int(columns.size)
            entries_all[:, columns] = -1
            continue
        picks = rng.integers(0, eligible.size, size=(draws, columns.size))
        entries = eligible[picks]
        direction = sides[rng.integers(0, sides.size, size=(draws, columns.size))]
        entry_ref = bars.open[entries]
        exit_ref = bars.close[entries + holding - 1]
        entry_fill = entry_ref + direction * _slip(entry_ref, config)
        exit_fill = exit_ref - direction * _slip(exit_ref, config)
        quantity = _quantities(trades, entry_fill, config, columns)
        fees = (entry_fill + exit_fill) * quantity * fee_rate + 2 * fixed_fee
        net = direction * quantity * (exit_fill - entry_fill) - fees
        totals += net.sum(axis=1)
        entries_all[:, columns] = entries
        sides_all[:, columns] = direction
    return totals, {"entries": entries_all, "sides": sides_all, "durations": durations}, unplaced


def status_for(percentile: float, config: HonestyConfig) -> CheckStatus:
    if percentile >= config.random_pass_percentile:
        return "PASS"
    if percentile >= config.random_warn_percentile:
        return "WARN"
    return "FAIL"


def percentile_of(value: float, distribution: np.ndarray) -> float:
    below = np.count_nonzero(distribution < value)
    equal = np.count_nonzero(distribution == value)
    return float((below + 0.5 * equal) / distribution.size * 100.0)


def histogram(distribution: np.ndarray, real: float, bins: int) -> Histogram:
    low = min(float(distribution.min()), real)
    high = max(float(distribution.max()), real)
    if not high > low:
        low, high = low - 1.0, high + 1.0
    edges = np.linspace(low, high, bins + 1)
    counts, _ = np.histogram(distribution, bins=edges)
    real_bin = int(np.clip(np.searchsorted(edges, real, side="right") - 1, 0, bins - 1))
    return Histogram(
        edges=edges.tolist(), counts=counts.astype(int).tolist(), real_value=real, real_bin=real_bin
    )


def evaluate(
    bars: BarSeries,
    sessions: SessionMap,
    trades: Sequence[Trade],
    spec: StrategySpec,
    warmup: int,
    backtest: BacktestConfig,
    config: HonestyConfig,
) -> tuple[CheckResult, RandomEntries]:
    count = len(trades)
    real = float(sum(trade.net_pnl for trade in trades))
    eligible_any = int(eligible_entries(sessions, warmup, 1, spec.time_exit.session_end).size)
    thresholds = {
        "pass_min_percentile": config.random_pass_percentile,
        "warn_min_percentile": config.random_warn_percentile,
        "min_trades": config.min_trades,
        "draws": config.random_draws,
    }
    if count == 0:
        summary = RandomEntries(
            draws=config.random_draws,
            seed=config.random_seed,
            trades_per_draw=0,
            eligible_entry_bars=eligible_any,
            real_net_pnl=real,
            percentile=None,
            mean=None,
            median=None,
            p5=None,
            p95=None,
            histogram=None,
        )
        check = CheckResult(
            id="versus_random",
            status="FAIL",
            headline="No trades, so there is nothing to compare with random entries",
            detail="The run produced no trades.",
            insufficient_data=True,
            measured={"trade_count": 0, "real_net_pnl": real, "percentile": None},
            thresholds=thresholds,
        )
        return check, summary
    totals, _, unplaced = simulate_draws(
        bars, sessions, trades, spec, warmup, backtest, config.random_draws, config.random_seed
    )
    percentile = percentile_of(real, totals)
    p5, median, p95 = (float(x) for x in np.percentile(totals, [5, 50, 95]))
    summary = RandomEntries(
        draws=config.random_draws,
        seed=config.random_seed,
        trades_per_draw=count,
        eligible_entry_bars=eligible_any,
        real_net_pnl=real,
        percentile=percentile,
        mean=float(totals.mean()),
        median=median,
        p5=p5,
        p95=p95,
        histogram=histogram(totals, real, config.random_bins),
    )
    insufficient = count < config.min_trades or unplaced > 0
    direction_text = SIDE_TEXT[tuple(allowed_sides(spec).tolist())]
    detail = (
        f"{config.random_draws:,} draws, each with {plural(count, 'trade')} that keep the real "
        f"holding durations but enter at random bars, {direction_text}, with the same costs "
        f"and position size. The real net P&L {money(real)} beats {percentile:.1f}% of the "
        f"draws (median {money(median)}, 5th to 95th percentile {money(p5)} to {money(p95)}). "
        "This measures how often random timing did as well on this data; it does not show "
        "that the strategy will keep working, and a high percentile can still be luck."
    )
    if unplaced:
        detail += (
            f" {plural(unplaced, 'trade')} could not be placed because no entry bar leaves "
            "room for its holding duration."
        )
    if count < config.min_trades:
        detail += f" Fewer than {config.min_trades} trades: too few to judge."
    status = status_for(percentile, config)
    headline = HEADLINES[status].format(percentile=percentile)
    check = CheckResult(
        id="versus_random",
        status=settle(status, insufficient),
        headline=headline,
        detail=detail,
        insufficient_data=insufficient,
        measured={
            "trade_count": count,
            "real_net_pnl": real,
            "percentile": percentile,
            "random_mean": summary.mean,
            "random_median": median,
            "random_p5": p5,
            "random_p95": p95,
            "unplaced_trades": unplaced,
        },
        thresholds=thresholds,
    )
    return check, summary
