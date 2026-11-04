import itertools

import pytest

from app.engine import run_backtest
from app.honesty import sweep
from app.honesty.config import HonestyConfig
from app.honesty.model import SweepAxis, SweepCell
from app.honesty.sweep import SweepError, SweepRequest, axis_values, parameter_part, run_sweep
from app.strategies.registry import LIBRARY, build_spec, validate_parameters
from tests.strategies.helpers import CRYPTO, random_crypto

CONFIG = HonestyConfig()
DONCHIAN = {definition.name: definition for definition in LIBRARY["donchian_breakout"].parameters}


@pytest.mark.parametrize(
    ("name", "chosen", "expected"),
    [
        ("entry_lookback", 20, [16, 18, 20, 22, 24]),
        ("stop_atr", 2.0, [1.5, 1.75, 2.0, 2.25, 2.5]),
        ("entry_lookback", 2, [2, 3, 4, 5, 6]),
        ("stop_atr", 10.0, [6.0, 7.0, 8.0, 9.0, 10.0]),
        ("exit_lookback", 0, [0, 1, 2, 3, 4]),
    ],
)
def test_axis_values_stay_in_range_and_on_step(name, chosen, expected):
    assert axis_values(DONCHIAN[name], chosen, 5, 0.1) == expected


def setup(count=3_000, seed=4):
    bars = random_crypto(count, seed)
    params = validate_parameters("donchian_breakout", {}, "crypto_24x7")
    spec = build_spec("donchian_breakout", params, "crypto_24x7")
    output = run_backtest(bars, spec, CRYPTO)
    return bars, params, output


def test_grid_cells_match_individual_engine_runs():
    bars, params, output = setup()
    request = SweepRequest("donchian_breakout", params, "crypto_24x7")
    result = run_sweep(request, bars, output.sessions, CRYPTO, CONFIG)
    assert result.combinations == 25
    assert result.completed == 25
    assert not result.stopped_by_budget
    assert result.chosen == [2, 2]
    chosen = next(cell for cell in result.cells if cell.coordinates == [2, 2])
    assert chosen.net_pnl == pytest.approx(output.result.metrics.summary.net_pnl)
    for coordinates in ([0, 0], [1, 3], [4, 4]):
        cell = next(cell for cell in result.cells if cell.coordinates == coordinates)
        values = dict(params)
        values["entry_lookback"] = int(cell.values["entry_lookback"])
        values["stop_atr"] = cell.values["stop_atr"]
        spec = build_spec("donchian_breakout", values, "crypto_24x7")
        summary = run_backtest(bars, spec, CRYPTO).result.metrics.summary
        assert cell.state == "ok"
        assert cell.net_pnl == pytest.approx(summary.net_pnl)
        assert cell.trade_count == summary.trade_count
        assert cell.profit_factor == pytest.approx(summary.profit_factor)


def test_combination_limit_is_enforced_before_running():
    bars, params, output = setup(count=500)
    config = HonestyConfig(sweep_values_per_parameter=20, sweep_max_combinations=100)
    request = SweepRequest("donchian_breakout", params, "crypto_24x7")
    with pytest.raises(SweepError, match="exceed the limit of 100"):
        run_sweep(request, bars, output.sessions, CRYPTO, config)


def test_time_budget_stops_the_sweep_and_says_so():
    bars, params, output = setup(count=500)
    ticks = itertools.count()
    config = HonestyConfig(sweep_time_budget_seconds=5)
    request = SweepRequest("donchian_breakout", params, "crypto_24x7")
    result = run_sweep(request, bars, output.sessions, CRYPTO, config, clock=lambda: next(ticks))
    assert result.stopped_by_budget
    assert result.completed == 4
    assert {cell.state for cell in result.cells} == {"ok", "not_run"}
    first = next(cell for cell in result.cells if cell.coordinates == result.chosen)
    assert first.state == "ok"
    assert "time budget" in parameter_part(result, config).reason


def test_invalid_combinations_are_marked_not_hidden():
    bars = random_crypto(600, 2)
    params = validate_parameters("rsi_mean_reversion", {"exit_rsi": 35}, "crypto_24x7")
    spec = build_spec("rsi_mean_reversion", params, "crypto_24x7")
    output = run_backtest(bars, spec, CRYPTO)
    request = SweepRequest("rsi_mean_reversion", params, "crypto_24x7")
    result = run_sweep(request, bars, output.sessions, CRYPTO, CONFIG)
    invalid = [cell for cell in result.cells if cell.state == "invalid"]
    assert invalid
    assert all(cell.values["oversold"] >= cell.values["exit_rsi"] for cell in invalid)
    assert all(cell.message for cell in invalid)


def test_custom_and_unknown_parameters_cannot_be_swept():
    bars, params, output = setup(count=500)
    with pytest.raises(SweepError, match="no sweepable"):
        run_sweep(SweepRequest("custom", {}, "crypto_24x7"), bars, output.sessions, CRYPTO, CONFIG)
    with pytest.raises(SweepError, match="not a numeric parameter"):
        run_sweep(
            SweepRequest("donchian_breakout", params, "crypto_24x7", ("directions",)),
            bars,
            output.sessions,
            CRYPTO,
            CONFIG,
        )


def surface(values):
    axes = [
        SweepAxis(name="a", label="A", values=[0, 1, 2, 3, 4], chosen=2),
        SweepAxis(name="b", label="B", values=[0, 1, 2, 3, 4], chosen=2),
    ]
    cells = {
        (i, j): SweepCell(
            coordinates=[i, j],
            values={"a": i, "b": j},
            state="ok",
            net_pnl=float(values[i][j]),
            profit_factor=None,
            trade_count=100,
        )
        for i in range(5)
        for j in range(5)
    }
    return sweep._detect(axes, (5, 5), cells, (2, 2), 25, False, 0.0, CONFIG)


def test_plateau_passes():
    result = surface([[100 + i + j for j in range(5)] for i in range(5)])
    assert result.profitable_neighbour_fraction == 1.0
    assert not result.chosen_is_spike
    assert not result.best_is_spike
    assert parameter_part(result, CONFIG).status == "PASS"


def test_isolated_spike_at_the_chosen_point_fails():
    grid = [[10] * 5 for _ in range(5)]
    grid[2][2] = 1_000
    result = surface(grid)
    assert result.profitable_neighbour_fraction == 1.0
    assert result.neighbour_median_share == pytest.approx(0.01)
    assert result.chosen_is_spike
    assert result.best == [2, 2]
    assert result.best_is_spike
    assert parameter_part(result, CONFIG).status == "FAIL"


def test_isolated_best_cell_elsewhere_is_reported():
    grid = [[100] * 5 for _ in range(5)]
    grid[0][4] = 5_000
    result = surface(grid)
    assert result.best == [0, 4]
    assert result.best_is_spike
    assert not result.chosen_is_spike
    part = parameter_part(result, CONFIG)
    assert part.status == "PASS"
    assert "isolated spike" in part.reason


@pytest.mark.parametrize(("losers", "status"), [(2, "PASS"), (3, "WARN"), (5, "FAIL")])
def test_neighbour_fraction_thresholds(losers, status):
    grid = [[50] * 5 for _ in range(5)]
    ring = [(1, 1), (1, 2), (1, 3), (2, 1), (2, 3), (3, 1), (3, 2), (3, 3)]
    for i, j in ring[:losers]:
        grid[i][j] = -50
    result = surface(grid)
    assert result.profitable_neighbour_fraction == pytest.approx((8 - losers) / 8)
    assert parameter_part(result, CONFIG).status == status
