import numpy as np
import pytest

from app.engine.backtest import run_plan
from app.engine.models import (
    BacktestConfig,
    CostModel,
    FixedFraction,
    Instrument,
    RiskLimits,
    SlippageTicks,
)
from app.engine.sessions import Crypto24x7Session, UsEquitySession
from tests.engine.factories import bars, flat
from tests.engine.scripted import scripted_plan

FAR = 1_000.0


def config(
    fee_pct=0.0,
    fixed_fee=0.0,
    slip_ticks=0.0,
    tick=0.5,
    step=1.0,
    fraction=1.0,
    session=None,
    **risk,
):
    return BacktestConfig(
        session=session or Crypto24x7Session(),
        instrument=Instrument(tick_size=tick, quantity_step=step),
        costs=CostModel(
            fee_pct=fee_pct, fixed_fee=fixed_fee, slippage=SlippageTicks(value=slip_ticks)
        ),
        sizing=FixedFraction(fraction=fraction),
        risk=RiskLimits(**{"max_trades_per_session": 10, **risk}),
    )


def run(rows, plan, cfg=None, **kwargs):
    series = bars(rows, **kwargs)
    return run_plan(series, plan, cfg or config(), "scripted").result


def only(result):
    assert len(result.trades) == 1
    return result.trades[0]


def test_signal_at_close_fills_at_next_open():
    rows = [flat(100), (100, 101, 99, 100), (102, 103, 101, 102), (104, 105, 103, 104)]
    trade = only(run(rows, scripted_plan(4, longs={1: (90, 120)})))
    assert (trade.signal_index, trade.entry_index) == (1, 2)
    assert trade.entry_price == 102.0
    assert trade.quantity == 98.0
    assert trade.exit_reason == "end_of_data" and trade.exit_price == 104.0


SLIPPAGE_ROWS = [flat(100), (100, 101, 99, 100), (110, 111, 109, 110)]


def test_slippage_is_adverse_for_long_on_entry_and_exit():
    trade = only(run(SLIPPAGE_ROWS, scripted_plan(3, longs={0: (50, FAR)}), config(slip_ticks=2)))
    assert trade.entry_price == 101.0 and trade.exit_price == 109.0
    assert trade.quantity == 99.0
    assert trade.gross_pnl == pytest.approx(990.0)
    assert trade.slippage_cost == pytest.approx(198.0)
    assert trade.net_pnl == pytest.approx(792.0)


def test_slippage_is_adverse_for_short_on_entry_and_exit():
    trade = only(run(SLIPPAGE_ROWS, scripted_plan(3, shorts={0: (200, 1.0)}), config(slip_ticks=2)))
    assert trade.side == "short"
    assert trade.entry_price == 99.0 and trade.exit_price == 111.0
    assert trade.quantity == 101.0
    assert trade.gross_pnl == pytest.approx(-1_010.0)
    assert trade.slippage_cost == pytest.approx(202.0)
    assert trade.net_pnl == pytest.approx(-1_212.0)


def test_fee_worked_example_0_1_percent_plus_2_per_fill():
    result = run(
        SLIPPAGE_ROWS, scripted_plan(3, longs={0: (50, FAR)}), config(fee_pct=0.1, fixed_fee=2)
    )
    trade = only(result)
    assert trade.quantity == 99.0
    assert trade.fees == pytest.approx(11.9 + 12.89)
    assert trade.net_pnl == pytest.approx(990 - 24.79)
    assert result.metrics.final_equity == pytest.approx(10_965.21)


def test_stop_is_assumed_first_when_one_bar_reaches_stop_and_target():
    rows = [flat(100), (100, 106, 94, 100), flat(100)]
    trade = only(run(rows, scripted_plan(3, longs={0: (95, 105)})))
    assert trade.exit_reason == "stop" and trade.exit_fill == "intrabar"
    assert (trade.exit_index, trade.exit_price, trade.bars_held) == (1, 95.0, 1)
    assert trade.net_pnl == pytest.approx(-500.0)


def test_short_stop_first_ambiguity_is_symmetric():
    rows = [flat(100), (100, 106, 94, 100), flat(100)]
    trade = only(run(rows, scripted_plan(3, shorts={0: (105, 95)})))
    assert (trade.exit_reason, trade.exit_price) == ("stop", 105.0)


def test_gap_through_the_stop_fills_at_the_open():
    rows = [flat(100), (100, 101, 99, 100), (90, 92, 88, 91)]
    trade = only(run(rows, scripted_plan(3, longs={0: (95, 105)})))
    assert (trade.exit_reason, trade.exit_fill, trade.exit_price) == ("stop", "open", 90.0)
    assert trade.bars_held == 1
    assert trade.net_pnl == pytest.approx(-1_000.0)


def test_gap_through_the_target_fills_at_the_open():
    rows = [flat(100), (100, 101, 99, 100), (110, 112, 109, 111)]
    trade = only(run(rows, scripted_plan(3, longs={0: (95, 105)})))
    assert (trade.exit_reason, trade.exit_fill, trade.exit_price) == ("target", "open", 110.0)


def test_target_fill_at_the_level_and_checked_from_the_entry_bar():
    rows = [flat(100), (100, 101, 99, 100), (101, 106, 100, 104)]
    trade = only(run(rows, scripted_plan(3, longs={0: (95, 105)})))
    assert (trade.exit_reason, trade.exit_fill, trade.exit_price) == ("target", "intrabar", 105.0)
    assert trade.net_pnl == pytest.approx(500.0)
    rows = [flat(100), (100, 105.5, 99, 100), flat(100)]
    trade = only(run(rows, scripted_plan(3, longs={0: (95, 105)})))
    assert (trade.exit_index, trade.exit_reason) == (1, "target")


def test_entry_is_refused_when_the_open_is_already_beyond_the_stop_or_target():
    rows = [flat(100), (94, 95, 93, 94), flat(100)]
    result = run(rows, scripted_plan(3, longs={0: (95, 105)}))
    assert result.trades == [] and result.diagnostics.skipped == {"stop_beyond_open": 1}
    rows = [flat(100), (106, 107, 105, 106), flat(100)]
    result = run(rows, scripted_plan(3, longs={0: (95, 105)}))
    assert result.trades == [] and result.diagnostics.skipped == {"target_beyond_open": 1}


def test_time_exit_at_the_close_of_the_early_close_session():
    rows = [(100 + i, 101 + i, 99 + i, 100.5 + i) for i in range(7)] + [flat(110)] * 2
    series_start = "2024-12-24 14:30"
    early = bars(rows[:7], start=series_start, timeframe="30m")
    late = bars(rows[7:], start="2024-12-26 14:30", timeframe="30m")
    series = early.replace(
        **{
            name: np.concatenate([getattr(early, name), getattr(late, name)])
            for name in ("ts_ns", "open", "high", "low", "close", "volume")
        }
    )
    plan = scripted_plan(9, longs={1: (50, FAR), 6: (50, FAR)}, session_end_exit=True)
    result = run_plan(series, plan, config(session=UsEquitySession()), "scripted").result
    trade = only(result)
    assert (trade.entry_index, trade.exit_index) == (2, 6)
    assert (trade.exit_reason, trade.exit_fill, trade.exit_price) == ("time_exit", "close", 106.5)
    assert trade.exit_time.isoformat() == "2024-12-24T17:30:00+00:00"
    assert result.diagnostics.skipped == {"session_end": 1}


def test_max_bars_held_exits_at_the_close_as_a_time_exit():
    rows = [flat(100)] + [(100 + i, 101 + i, 99 + i, 100 + i) for i in range(5)]
    trade = only(run(rows, scripted_plan(6, longs={0: (50, FAR)}, max_bars=3)))
    assert (trade.entry_index, trade.exit_index, trade.bars_held) == (1, 3, 3)
    assert (trade.exit_reason, trade.exit_price) == ("time_exit", 102.0)


def test_exit_signal_at_close_fills_at_next_open():
    rows = [flat(100), flat(100), flat(101), (103, 104, 102, 103), flat(103)]
    trade = only(run(rows, scripted_plan(5, longs={0: (50, FAR)}, long_exits=[2])))
    assert (trade.exit_reason, trade.exit_fill, trade.exit_index) == ("exit_signal", "open", 3)
    assert trade.exit_price == 103.0 and trade.bars_held == 2


def test_trades_per_session_cap():
    rows = [flat(100)] * 10
    plan = scripted_plan(10, longs={1: (50, FAR), 5: (50, FAR)}, long_exits=[3])
    capped = run(rows, plan, config(max_trades_per_session=1))
    assert len(capped.trades) == 1 and capped.diagnostics.skipped == {"trade_cap": 1}
    assert [t.entry_index for t in run(rows, plan, config(max_trades_per_session=2)).trades] == [
        2,
        6,
    ]
    default = run_plan(
        bars(rows), plan, BacktestConfig(session=Crypto24x7Session()), "scripted"
    ).result
    assert len(default.trades) == 1


def test_session_loss_limit_flattens_next_open_and_blocks_the_session():
    rows = [flat(100)] * 30
    rows[1] = (100, 100, 95, 96)
    rows[2] = (97, 98, 96, 97)
    plan = scripted_plan(30, longs={0: (80, FAR), 3: (80, FAR), 24: (80, FAR)})
    result = run(rows, plan, config(max_session_loss_pct=3))
    first, second = result.trades
    assert (first.exit_reason, first.exit_fill, first.exit_index) == ("risk_limit", "open", 2)
    assert first.net_pnl == pytest.approx(-300.0)
    assert second.entry_index == 25
    assert result.diagnostics.skipped == {"session_loss_limit": 1}


def test_max_drawdown_halts_the_run():
    rows = [flat(100)] * 12
    rows[1] = (100, 100, 93, 94)
    rows[2] = (95, 96, 94, 95)
    plan = scripted_plan(12, longs={0: (80, FAR), 4: (80, FAR), 8: (80, FAR)})
    output = run_plan(bars(rows), plan, config(max_drawdown_pct=5), "scripted")
    result = output.result
    trade = only(result)
    assert (trade.exit_reason, trade.exit_index, trade.exit_price) == ("risk_limit", 2, 95.0)
    assert result.halted is not None
    assert (result.halted.bar_index, result.halted.drawdown_pct) == (1, pytest.approx(6.0))
    assert result.diagnostics.entries == 1
    assert output.equity[2:].tolist() == [9_500.0] * 10


def test_no_trade_before_warmup():
    rows = [flat(100)] * 20
    result = run(rows, scripted_plan(20, longs={3: (50, FAR), 12: (50, FAR)}, warmup=10))
    assert [t.signal_index for t in result.trades] == [12]
    assert result.diagnostics.skipped == {"warmup": 1}


def test_long_and_short_on_the_same_bar_is_refused():
    rows = [flat(100)] * 4
    result = run(rows, scripted_plan(4, longs={1: (50, FAR)}, shorts={1: (150, 1.0)}))
    assert result.trades == [] and result.diagnostics.skipped == {"conflicting_signals": 1}


def test_one_position_at_a_time():
    rows = [flat(100)] * 8
    plan = scripted_plan(8, longs={0: (50, FAR), 2: (50, FAR), 5: (50, FAR)}, long_exits=[4])
    result = run(rows, plan)
    assert [(t.entry_index, t.exit_index) for t in result.trades] == [(1, 5), (6, 7)]


def test_moving_target_uses_the_level_known_at_the_previous_close():
    rows = [flat(100), (100, 103, 99, 102), (102, 105, 101, 104), flat(104)]
    moving = np.array([103.5, 104.5, 106.0, 110.0])
    plan = scripted_plan(4, longs={0: (90, None)}, moving_target=moving)
    trade = only(run(rows, plan))
    assert (trade.exit_index, trade.exit_reason, trade.exit_price) == (2, "target", 104.5)


def test_equity_identity_and_determinism_with_costs():
    rng = np.random.default_rng(3)
    close = 100 + np.cumsum(rng.normal(0, 1, 300))
    rows = [(c, c + 1, c - 1, c + rng.uniform(-1, 1)) for c in close]
    rows = [(o, max(h, c), min(lo, c), c) for o, h, lo, c in rows]
    entries = {i: (rows[i][3] - 3, rows[i][3] + 3) for i in range(0, 290, 7)}
    plan = scripted_plan(300, longs=entries, long_exits=range(3, 300, 11))
    cfg = config(fee_pct=0.05, fixed_fee=1, slip_ticks=1, step=None)
    first = run(rows, plan, cfg)
    second = run(rows, plan, cfg)
    assert first.model_dump() == second.model_dump()
    assert len(first.trades) > 10
    total = sum(t.net_pnl for t in first.trades)
    assert first.metrics.final_equity == pytest.approx(10_000 + total, abs=1e-6)
    for trade in first.trades:
        assert trade.net_pnl == pytest.approx(trade.gross_pnl - trade.fees - trade.slippage_cost)


GOLDEN_EXPECTED = [
    ("long", 0, 1, 1, "intrabar", "target", 19, 100.5, 104.5, 95, 2, 19, 74, 1),
    ("long", 2, 3, 3, "intrabar", "stop", 19, 100.5, 94.5, -95, 2, 19, -116, 1),
    ("long", 5, 6, 8, "open", "exit_signal", 19, 100.5, 101.5, 38, 2, 19, 17, 2),
    ("short", 9, 10, 12, "close", "time_exit", 20, 99.5, 97.5, 60, 2, 20, 38, 3),
    ("long", 24, 25, 26, "open", "risk_limit", 19, 100.5, 84.5, -285, 2, 19, -306, 1),
    ("long", 48, 49, 50, "close", "end_of_data", 19, 100.5, 103.5, 76, 2, 19, 55, 2),
]


def golden_rows():
    rows = [flat(100)] * 51
    rows[1] = (100, 106, 99, 104)
    rows[3] = (100, 101, 94, 96)
    rows[6] = (100, 101, 99.5, 100.5)
    rows[7] = (100.5, 101.5, 100, 101)
    rows[8] = (102, 102.5, 101.5, 102)
    rows[10] = (100, 100.5, 98.5, 99)
    rows[11] = (99, 99.5, 97.5, 98)
    rows[12] = (98, 98.5, 96.5, 97)
    rows[25] = (100, 100.5, 83.5, 84)
    rows[26] = (85, 86, 84, 85)
    rows[49] = (100, 101, 99.5, 100.5)
    rows[50] = (100.5, 104.5, 100, 104)
    return rows


def test_golden_trade_table_covers_every_exit_reason():
    plan = scripted_plan(
        51,
        longs={
            0: (95, 105),
            2: (95, 110),
            5: (90, FAR),
            24: (70, FAR),
            30: (70, FAR),
            48: (90, FAR),
        },
        shorts={9: (110, None)},
        long_exits=[7],
        max_bars=3,
    )
    cfg = config(fixed_fee=1, slip_ticks=1, tick=0.5, fraction=0.2, max_session_loss_pct=3)
    result = run(golden_rows(), plan, cfg)
    table = [
        (
            t.side,
            t.signal_index,
            t.entry_index,
            t.exit_index,
            t.exit_fill,
            t.exit_reason,
            t.quantity,
            t.entry_price,
            t.exit_price,
            t.gross_pnl,
            t.fees,
            t.slippage_cost,
            t.net_pnl,
            t.bars_held,
        )
        for t in result.trades
    ]
    assert len(table) == len(GOLDEN_EXPECTED)
    for actual, expected in zip(table, GOLDEN_EXPECTED, strict=True):
        assert actual[:6] == expected[:6]
        assert actual[6:13] == pytest.approx(expected[6:13])
        assert actual[13] == expected[13]
    assert {t.exit_reason for t in result.trades} == {
        "stop",
        "target",
        "time_exit",
        "exit_signal",
        "risk_limit",
        "end_of_data",
    }
    assert result.diagnostics.skipped == {"session_loss_limit": 1}
    assert result.metrics.final_equity == pytest.approx(9_762.0)
