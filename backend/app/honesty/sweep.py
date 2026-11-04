import itertools
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import numpy as np
from pydantic import ValidationError

from app.engine.backtest import IncompatibleMarketError, run_plan
from app.engine.bars import BarSeries
from app.engine.models import BacktestConfig
from app.engine.sessions import MarketKind, SessionMap
from app.engine.signals import SpecError, compile_spec
from app.honesty.config import HonestyConfig
from app.honesty.model import ParameterPart, SweepAxis, SweepCell, SweepResult
from app.honesty.text import money, percent
from app.strategies.params import ParamDef, ParameterError, ParamValue
from app.strategies.registry import LIBRARY, build_spec

HARD_COMBINATION_LIMIT = 400
DEFAULT_AXES: dict[str, tuple[str, ...]] = {
    "orb": ("range_minutes", "target_r"),
    "vwap_mean_reversion": ("threshold_std", "stop_atr"),
    "gap_fade": ("min_gap_pct", "stop_gap_fraction"),
    "donchian_breakout": ("entry_lookback", "stop_atr"),
    "rsi_mean_reversion": ("oversold", "exit_rsi"),
}

Clock = Callable[[], float]


class SweepError(ValueError):
    pass


@dataclass(frozen=True)
class SweepRequest:
    strategy_id: str
    parameters: Mapping[str, ParamValue]
    market: MarketKind
    names: tuple[str, ...] | None = None


def _definitions(request: SweepRequest) -> list[ParamDef]:
    strategy = LIBRARY.get(request.strategy_id)
    if strategy is None:
        raise SweepError("the strategy declares no sweepable parameters.")
    by_name = {definition.name: definition for definition in strategy.parameters}
    names = request.names or DEFAULT_AXES[request.strategy_id]
    if not 1 <= len(names) <= 2 or len(set(names)) != len(names):
        raise SweepError("a sweep takes one or two distinct parameters.")
    chosen = []
    for name in names:
        definition = by_name.get(name)
        if definition is None or definition.type == "choice":
            raise SweepError(f"{name!r} is not a numeric parameter of {request.strategy_id}.")
        chosen.append(definition)
    return chosen


def _snap(definition: ParamDef, value: float) -> float:
    assert definition.minimum is not None and definition.step is not None
    steps = round((value - definition.minimum) / definition.step)
    snapped = definition.minimum + steps * definition.step
    return float(round(snapped)) if definition.type == "int" else round(snapped, 10)


def axis_values(
    definition: ParamDef, chosen: float, count: int, relative_spacing: float
) -> list[float]:
    assert definition.minimum is not None and definition.maximum is not None
    assert definition.step is not None
    multiples = max(1, round(abs(chosen) * relative_spacing / definition.step))
    spacing = multiples * definition.step
    candidates = []
    for k in range(-count, count + 1):
        value = _snap(definition, chosen + k * spacing)
        if definition.minimum - 1e-9 <= value <= definition.maximum + 1e-9:
            candidates.append((abs(k), k, value))
    candidates.sort()
    return sorted({value for _, _, value in candidates[:count]})


def neighbour_offsets(dimensions: int) -> list[tuple[int, ...]]:
    if dimensions == 1:
        return [(-2,), (-1,), (1,), (2,)]
    return [offset for offset in itertools.product((-1, 0, 1), repeat=2) if any(offset)]


def _neighbours(point: tuple[int, ...], shape: tuple[int, ...]) -> list[tuple[int, ...]]:
    found = []
    for offset in neighbour_offsets(len(shape)):
        candidate = tuple(p + o for p, o in zip(point, offset, strict=True))
        if all(0 <= c < s for c, s in zip(candidate, shape, strict=True)):
            found.append(candidate)
    return found


def _distance(point: tuple[int, ...], other: tuple[int, ...]) -> int:
    return max(abs(p - o) for p, o in zip(point, other, strict=True))


def _value(definition: ParamDef, value: float) -> ParamValue:
    return round(value) if definition.type == "int" else float(value)


def run_sweep(
    request: SweepRequest,
    bars: BarSeries,
    sessions: SessionMap,
    backtest: BacktestConfig,
    config: HonestyConfig,
    clock: Clock = time.perf_counter,
) -> SweepResult:
    definitions = _definitions(request)
    axes = []
    for definition in definitions:
        chosen = float(request.parameters[definition.name])
        values = axis_values(
            definition, chosen, config.sweep_values_per_parameter, config.sweep_relative_spacing
        )
        if chosen not in values:
            values = sorted({*values, chosen})
        axes.append(
            SweepAxis(name=definition.name, label=definition.label, values=values, chosen=chosen)
        )
    shape = tuple(len(axis.values) for axis in axes)
    combinations = int(np.prod(shape))
    limit = min(config.sweep_max_combinations, HARD_COMBINATION_LIMIT)
    if combinations > limit:
        raise SweepError(f"{combinations} combinations exceed the limit of {limit}.")
    chosen_point = tuple(axis.values.index(axis.chosen) for axis in axes)
    order = sorted(
        itertools.product(*(range(size) for size in shape)),
        key=lambda point: (_distance(point, chosen_point), point),
    )
    started = clock()
    stopped = False
    cells: dict[tuple[int, ...], SweepCell] = {}
    for point in order:
        values = {axis.name: axis.values[i] for axis, i in zip(axes, point, strict=True)}
        if stopped or clock() - started >= config.sweep_time_budget_seconds:
            stopped = True
            cells[point] = SweepCell(
                coordinates=list(point),
                values=values,
                state="not_run",
                net_pnl=None,
                profit_factor=None,
                trade_count=None,
            )
            continue
        parameters = dict(request.parameters)
        for definition in definitions:
            parameters[definition.name] = _value(definition, values[definition.name])
        try:
            spec = build_spec(request.strategy_id, parameters, request.market)
            plan = compile_spec(spec, bars, sessions)
        except (ParameterError, IncompatibleMarketError, SpecError, ValidationError) as error:
            cells[point] = SweepCell(
                coordinates=list(point),
                values=values,
                state="invalid",
                net_pnl=None,
                profit_factor=None,
                trade_count=None,
                message=str(error)[:200],
            )
            continue
        summary = run_plan(bars, plan, backtest, spec.name, sessions).result.metrics.summary
        cells[point] = SweepCell(
            coordinates=list(point),
            values=values,
            state="ok",
            net_pnl=summary.net_pnl,
            profit_factor=summary.profit_factor,
            trade_count=summary.trade_count,
        )
    elapsed = clock() - started
    return _detect(axes, shape, cells, chosen_point, combinations, stopped, elapsed, config)


def _ok_net(cells: dict[tuple[int, ...], SweepCell], point: tuple[int, ...]) -> float | None:
    cell = cells[point]
    return cell.net_pnl if cell.state == "ok" else None


def _is_spike(
    cells: dict[tuple[int, ...], SweepCell],
    point: tuple[int, ...],
    shape: tuple[int, ...],
    ratio: float,
) -> bool:
    net = _ok_net(cells, point)
    if net is None or net <= 0:
        return False
    around = [_ok_net(cells, n) for n in _neighbours(point, shape)]
    nets = [value for value in around if value is not None]
    return bool(nets) and float(np.median(nets)) < ratio * net


def _detect(
    axes: list[SweepAxis],
    shape: tuple[int, ...],
    cells: dict[tuple[int, ...], SweepCell],
    chosen: tuple[int, ...],
    combinations: int,
    stopped: bool,
    elapsed: float,
    config: HonestyConfig,
) -> SweepResult:
    ok = [point for point, cell in cells.items() if cell.state == "ok"]
    best = max(ok, key=lambda point: (cells[point].net_pnl, point), default=None)
    neighbours = _neighbours(chosen, shape)
    nets = [value for value in (_ok_net(cells, n) for n in neighbours) if value is not None]
    fraction = sum(1 for value in nets if value > 0) / len(nets) if nets else None
    chosen_net = _ok_net(cells, chosen)
    median_share = None
    if nets and chosen_net is not None and chosen_net > 0:
        median_share = float(np.median(nets)) / chosen_net
    return SweepResult(
        axes=axes,
        cells=[cells[point] for point in sorted(cells)],
        chosen=list(chosen),
        best=list(best) if best is not None else None,
        combinations=combinations,
        completed=sum(1 for cell in cells.values() if cell.state != "not_run"),
        stopped_by_budget=stopped,
        elapsed_seconds=elapsed,
        neighbour_count=len(neighbours),
        profitable_neighbour_fraction=fraction,
        neighbour_median_share=median_share,
        chosen_is_spike=_is_spike(cells, chosen, shape, config.sweep_spike_ratio),
        best_is_spike=best is not None and _is_spike(cells, best, shape, config.sweep_spike_ratio),
    )


def parameter_part(sweep: SweepResult, config: HonestyConfig) -> ParameterPart:
    evaluated = sum(
        1
        for n in _neighbours(tuple(sweep.chosen), tuple(len(a.values) for a in sweep.axes))
        if next(c for c in sweep.cells if tuple(c.coordinates) == n).state == "ok"
    )
    insufficient = evaluated * 2 < sweep.neighbour_count or evaluated == 0
    fraction = sweep.profitable_neighbour_fraction
    names = " and ".join(axis.name for axis in sweep.axes)
    reason = (
        f"{sweep.completed} of {sweep.combinations} settings of {names} run; "
        f"{evaluated} of {sweep.neighbour_count} neighbours of the chosen setting evaluated, "
        f"{percent(fraction)} of them profitable"
    )
    if sweep.neighbour_median_share is not None:
        reason += f", median neighbour net {percent(sweep.neighbour_median_share)} of the chosen"
    reason += "."
    if sweep.chosen_is_spike:
        reason += " The chosen setting is an isolated spike: its neighbours earn far less."
    if sweep.best is not None and sweep.best != sweep.chosen:
        best = next(c for c in sweep.cells if c.coordinates == sweep.best)
        reason += f" Best setting in the grid: {money(best.net_pnl or 0.0)}"
        reason += " (an isolated spike)." if sweep.best_is_spike else "."
    if sweep.stopped_by_budget:
        reason += f" The sweep stopped at the {config.sweep_time_budget_seconds:g} s time budget."
    if fraction is None:
        status = "WARN"
    elif sweep.chosen_is_spike or fraction < config.sweep_warn_neighbours:
        status = "FAIL"
    elif fraction < config.sweep_pass_neighbours:
        status = "WARN"
    else:
        status = "PASS"
    if insufficient and status == "PASS":
        status = "WARN"
    return ParameterPart(status=status, insufficient_data=insufficient, reason=reason)


def not_run(reason: str) -> ParameterPart:
    return ParameterPart(status="not_run", insufficient_data=False, reason=reason)
