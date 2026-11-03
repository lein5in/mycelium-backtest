from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.base import LibraryStrategy
from app.strategies.blocks import atr_stop, cond, indicator, price, sides
from app.strategies.params import ParamValue, directions_param, float_param, int_param

PARAMETERS = (
    int_param(
        "entry_lookback",
        "Entry channel",
        20,
        2,
        500,
        "Enter on a close beyond the highest high or lowest low of the previous N bars.",
        unit="bars",
    ),
    float_param(
        "stop_atr",
        "Stop distance",
        2.0,
        0.25,
        10.0,
        0.25,
        "Stop distance from the entry as a multiple of ATR(14).",
        unit="x ATR(14)",
    ),
    int_param(
        "exit_lookback",
        "Exit channel",
        10,
        0,
        500,
        "Exit on a close beyond the opposite channel of the previous N bars; 0 disables.",
        unit="bars",
    ),
    int_param(
        "max_bars",
        "Maximum bars held",
        0,
        0,
        1_000,
        "Exit at the close after this many bars in the trade; 0 disables.",
        unit="bars",
    ),
    directions_param(),
)


def _side(values: dict[str, ParamValue], long: bool) -> dict:
    entry_lookback = int(values["entry_lookback"])
    exit_lookback = int(values["exit_lookback"])
    close = price("close")
    rules: dict = {
        "entry": [
            cond(close, ">", indicator("donchian_high", entry_lookback))
            if long
            else cond(close, "<", indicator("donchian_low", entry_lookback))
        ],
        "stop": atr_stop(float(values["stop_atr"])),
    }
    if exit_lookback > 0:
        rules["exit_any"] = [
            cond(close, "<", indicator("donchian_low", exit_lookback))
            if long
            else cond(close, ">", indicator("donchian_high", exit_lookback))
        ]
    return rules


def build(values: dict[str, ParamValue], market: MarketKind) -> StrategySpec:
    max_bars = int(values["max_bars"])
    return StrategySpec.model_validate(
        {
            "name": "Donchian Channel Breakout",
            "markets": ["us_equity", "crypto_24x7"],
            **sides(values["directions"], _side(values, True), _side(values, False)),
            "time_exit": {"session_end": False, "max_bars": max_bars or None},
        }
    )


STRATEGY = LibraryStrategy(
    id="donchian_breakout",
    name="Donchian Channel Breakout",
    summary="Follows a close beyond the highest high or lowest low of the previous N bars.",
    idea=(
        "A classic trend-following rule: a close above the highest high of the last N bars "
        "(or below the lowest low) suggests a new move. The channel never includes the current "
        "bar. The position exits on the stop or when price closes beyond a shorter channel on "
        "the other side."
    ),
    works_when=(
        "Markets with long, persistent trends where breakouts are followed by extended moves "
        "that pay for many small losing trades."
    ),
    fails_when=(
        "Sideways markets with frequent false breakouts, and sharp reversals right after a "
        "new high or low."
    ),
    markets=("us_equity", "crypto_24x7"),
    timeframes=("15m", "30m", "1h", "4h", "1d"),
    parameters=PARAMETERS,
    build=build,
)
