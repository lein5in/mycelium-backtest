import numpy as np
import pandas as pd
import pytest

from app.engine import (
    BacktestConfig,
    BarsValidationError,
    IncompatibleMarketError,
    StrategySpec,
    run_backtest,
    validate_bars,
)
from app.engine.models import CostModel, Instrument, RiskLimits, RiskPercent, SlippageTicks
from app.engine.sessions import Crypto24x7Session, UsEquitySession, map_sessions
from app.engine.signals import Evaluator, SpecError, compile_spec
from app.engine.spec import OpeningRange, SessionValue
from tests.engine.factories import bars, frame

CRYPTO = BacktestConfig(
    session=Crypto24x7Session(),
    costs=CostModel(fee_pct=0.05, fixed_fee=0.5, slippage=SlippageTicks(value=1)),
    risk=RiskLimits(max_trades_per_session=5, max_session_loss_pct=5),
)


def const(value):
    return {"kind": "constant", "value": value}


def cond(left, op, right):
    return {"left": left, "op": op, "right": right}


MIXED_SPEC = StrategySpec.model_validate(
    {
        "name": "mixed",
        "markets": ["crypto_24x7"],
        "long": {
            "entry": [
                cond({"kind": "close"}, ">", {"kind": "donchian_high", "period": 20}),
                cond({"kind": "adx", "period": 14}, ">", const(15)),
            ],
            "stop": {"type": "atr", "period": 14, "multiple": 2.0},
            "target": {"type": "r_multiple", "multiple": 2.0},
            "exit_any": [cond({"kind": "close"}, "<", {"kind": "ema", "period": 10})],
        },
        "short": {
            "entry": [
                cond({"kind": "rsi", "period": 14}, "crosses_below", const(70)),
                cond(
                    {"kind": "close"},
                    ">",
                    {
                        "kind": "linear",
                        "terms": [
                            {"operand": {"kind": "vwap"}},
                            {"operand": {"kind": "vwap_dev_std", "period": 30}, "coef": 0.5},
                        ],
                    },
                ),
            ],
            "stop": {"type": "fixed", "distance": 2.0},
            "target": {"type": "moving", "level": {"kind": "vwap"}},
        },
        "time_exit": {"session_end": True, "max_bars": 30},
    }
)


def random_rows(size, seed, start_price=100.0):
    rng = np.random.default_rng(seed)
    close = start_price + np.cumsum(rng.normal(0, 0.6, size))
    open_ = np.r_[start_price, close[:-1]] + rng.normal(0, 0.1, size)
    high = np.maximum(open_, close) + rng.uniform(0, 0.8, size)
    low = np.minimum(open_, close) - rng.uniform(0, 0.8, size)
    return [tuple(row) for row in np.column_stack([open_, high, low, close])]


def series(rows, start="2024-01-01", timeframe="1h"):
    return bars(rows, start=start, timeframe=timeframe)


def plan_arrays(plan):
    arrays = []
    for side in (plan.long, plan.short):
        arrays.extend([side.entry, side.stop_value])
        if side.target_value is not None:
            arrays.append(side.target_value)
        if side.exit is not None:
            arrays.append(side.exit)
    return arrays


@pytest.mark.parametrize("k", [120, 300, 470])
def test_no_look_ahead_changing_bars_after_k(k):
    rows = random_rows(600, seed=11)
    altered = rows[: k + 1] + random_rows(600 - k - 1, seed=99, start_price=rows[k][3] + 5)
    base = series(rows)
    changed = series(altered)
    sessions = map_sessions(CRYPTO.session, base.ts_ns, 60)
    for original, modified in zip(
        plan_arrays(compile_spec(MIXED_SPEC, base, sessions)),
        plan_arrays(compile_spec(MIXED_SPEC, changed, sessions)),
        strict=True,
    ):
        np.testing.assert_array_equal(original[: k + 1], modified[: k + 1])
    first = run_backtest(base, MIXED_SPEC, CRYPTO).result.trades
    second = run_backtest(changed, MIXED_SPEC, CRYPTO).result.trades
    assert len(first) > 5
    closed_first = [t for t in first if t.exit_index <= k]
    closed_second = [t for t in second if t.exit_index <= k]
    assert closed_first == closed_second
    assert [t.signal_index for t in first if t.signal_index < k] == [
        t.signal_index for t in second if t.signal_index < k
    ]


def test_determinism_of_a_full_spec_run():
    data = series(random_rows(800, seed=5))
    first = run_backtest(data, MIXED_SPEC, CRYPTO).result.model_dump_json()
    assert first == run_backtest(data, MIXED_SPEC, CRYPTO).result.model_dump_json()


def donchian_spec(side, entry_kind, exit_kind, entry_op, exit_op):
    return StrategySpec.model_validate(
        {
            "name": f"donchian {side}",
            "markets": ["crypto_24x7"],
            side: {
                "entry": [cond({"kind": "close"}, entry_op, {"kind": entry_kind, "period": 10})],
                "stop": {"type": "atr", "period": 14, "multiple": 2.0},
                "exit_any": [cond({"kind": "close"}, exit_op, {"kind": exit_kind, "period": 5})],
            },
            "time_exit": {"session_end": False},
        }
    )


def test_long_and_short_are_symmetric_on_a_mirrored_series():
    rng = np.random.default_rng(21)
    close = 1_000 + np.cumsum(rng.integers(-3, 4, 700)).astype(float)
    open_ = np.r_[1_000.0, close[:-1]]
    high = np.maximum(open_, close) + rng.integers(0, 3, 700)
    low = np.minimum(open_, close) - rng.integers(0, 3, 700)
    rows = list(zip(open_, high, low, close, strict=True))
    mirrored = [(2_000 - o, 2_000 - lo, 2_000 - h, 2_000 - c) for o, h, lo, c in rows]
    config = BacktestConfig(
        session=Crypto24x7Session(),
        instrument=Instrument(tick_size=1.0),
        costs=CostModel(fixed_fee=1.0, slippage=SlippageTicks(value=1)),
        sizing=RiskPercent(percent=0.2),
        risk=RiskLimits(max_trades_per_session=24),
    )
    long_spec = donchian_spec("long", "donchian_high", "donchian_low", ">", "<")
    short_spec = donchian_spec("short", "donchian_low", "donchian_high", "<", ">")
    longs = run_backtest(series(rows), long_spec, config).result
    shorts = run_backtest(series(mirrored), short_spec, config).result
    assert len(longs.trades) >= 5
    assert len(longs.trades) == len(shorts.trades)
    for a, b in zip(longs.trades, shorts.trades, strict=True):
        assert (a.signal_index, a.entry_index, a.exit_index, a.exit_reason) == (
            b.signal_index,
            b.entry_index,
            b.exit_index,
            b.exit_reason,
        )
        assert a.quantity == pytest.approx(b.quantity)
        assert a.entry_price == pytest.approx(2_000 - b.entry_price)
        assert a.net_pnl == pytest.approx(b.net_pnl)
    assert longs.metrics.final_equity == pytest.approx(shorts.metrics.final_equity)


def test_no_trade_before_the_indicator_warmup():
    spec = StrategySpec.model_validate(
        {
            "name": "sma",
            "markets": ["crypto_24x7"],
            "long": {
                "entry": [cond({"kind": "close"}, ">", {"kind": "sma", "period": 50})],
                "stop": {"type": "atr", "period": 60, "multiple": 3},
            },
            "time_exit": {"session_end": False, "max_bars": 2},
        }
    )
    rows = [(100 + i, 101 + i, 99 + i, 100.5 + i) for i in range(120)]
    result = run_backtest(series(rows), spec, CRYPTO).result
    assert result.warmup_bars == 60
    assert result.trades and min(t.signal_index for t in result.trades) >= 60


def test_incompatible_market_is_rejected_with_an_explicit_message():
    spec = MIXED_SPEC.model_copy(update={"markets": ["us_equity"]})
    with pytest.raises(IncompatibleMarketError, match="does not support crypto_24x7"):
        run_backtest(series(random_rows(50, 1)), spec, CRYPTO)


def test_bars_outside_us_sessions_are_reported_not_dropped():
    data = series(random_rows(30, 2), start="2024-12-24 14:30", timeframe="30m")
    spec = MIXED_SPEC.model_copy(update={"markets": ["us_equity"]})
    with pytest.raises(BarsValidationError) as caught:
        run_backtest(data, spec, BacktestConfig(session=UsEquitySession()))
    problem = caught.value.problems[0]
    assert problem.code == "outside_session" and problem.count == 23


def test_progress_reports_stages_in_order():
    seen = []
    run_backtest(
        series(random_rows(400, 3)),
        MIXED_SPEC,
        CRYPTO,
        progress=lambda stage, percent, bar: seen.append((stage, percent)),
    )
    stages = [stage for stage, _ in seen]
    assert stages[:4] == ["DATA", "DATA", "SIGNALS", "SIGNALS"]
    assert stages[-2:] == ["REPORTER", "REPORTER"]
    simulator = [p for s, p in seen if s == "SIMULATOR"]
    assert simulator == sorted(simulator) and simulator[-1] == 100


def us_session_bars(days, rows_per_day, timeframe="5m"):
    frames = []
    for day, rows in zip(days, rows_per_day, strict=True):
        frames.append(frame(rows, f"{day} 14:30", {"5m": "5min", "30m": "30min"}[timeframe]))
    return validate_bars(pd.concat(frames), timeframe)


def test_opening_range_is_defined_only_after_the_range_is_complete():
    rows = [(10, 10 + i, 10 - i, 10) for i in range(1, 9)]
    data = us_session_bars(["2024-12-23"], [rows])
    sessions = map_sessions(UsEquitySession(), data.ts_ns, 5)
    evaluator = Evaluator(data, sessions)
    high = evaluator.operand(OpeningRange(kind="opening_range_high", minutes=30))
    low = evaluator.operand(OpeningRange(kind="opening_range_low", minutes=30))
    assert np.isnan(high[:6]).all() and high[6:].tolist() == [16, 16]
    assert low[6:].tolist() == [4, 4]
    with pytest.raises(SpecError, match="whole multiple"):
        evaluator.operand(OpeningRange(kind="opening_range_high", minutes=32))


def test_opening_range_is_nan_when_the_session_starts_late():
    rows = [(10, 11, 9, 10)] * 8
    data = validate_bars(frame(rows, "2024-12-23 14:40", "5min"), "5m")
    sessions = map_sessions(UsEquitySession(), data.ts_ns, 5)
    values = Evaluator(data, sessions).operand(OpeningRange(kind="opening_range_high", minutes=30))
    assert np.isnan(values).all()


def test_previous_session_close_skips_the_holiday_and_rejects_missing_sessions():
    full_day = [(10 + i * 0.1, 11 + i * 0.1, 9 + i * 0.1, 10 + i * 0.1) for i in range(78)]
    early = [(20, 21, 19, 20)] * 42
    data = us_session_bars(
        ["2021-12-23", "2021-12-27", "2021-12-29"], [full_day, early, early], timeframe="5m"
    )
    sessions = map_sessions(UsEquitySession(), data.ts_ns, 5)
    evaluator = Evaluator(data, sessions)
    previous = evaluator.operand(SessionValue(kind="prev_session_close"))
    assert np.isnan(previous[:78]).all()
    assert previous[78:120].tolist() == [pytest.approx(17.7)] * 42
    assert np.isnan(previous[120:]).all()
    session_open = evaluator.operand(SessionValue(kind="session_open"))
    assert session_open[78] == 20 and session_open[100] == 20


def test_minutes_since_open_and_bar_in_session_follow_the_calendar():
    data = us_session_bars(["2024-12-24"], [[(10, 11, 9, 10)] * 42])
    evaluator = Evaluator(data, map_sessions(UsEquitySession(), data.ts_ns, 5))
    minutes = evaluator.operand(SessionValue(kind="minutes_since_open"))
    index = evaluator.operand(SessionValue(kind="bar_in_session"))
    assert minutes[:3].tolist() == [0, 5, 10] and minutes[-1] == 205
    assert index[-1] == 41
