from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.base import LibraryStrategy
from app.strategies.blocks import atr_stop, cond, const, indicator, price, sides
from app.strategies.params import ParamValue, directions_param, float_param, int_param

PARAMETERS = (
    int_param("rsi_period", "RSI period", 14, 2, 100, "Number of bars of the RSI.", unit="bars"),
    int_param(
        "oversold",
        "Oversold level",
        30,
        5,
        50,
        "A long needs the RSI to cross back above this level.",
    ),
    int_param(
        "overbought",
        "Overbought level",
        70,
        50,
        95,
        "A short needs the RSI to cross back below this level.",
    ),
    int_param(
        "trend_sma",
        "Trend filter",
        200,
        0,
        500,
        "Longs only above, shorts only below the simple moving average of this length; "
        "0 disables the filter.",
        unit="bars",
    ),
    int_param(
        "exit_rsi",
        "Exit RSI level",
        50,
        5,
        95,
        "Exit at the next open once the RSI reaches this level at a close.",
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
        "max_bars",
        "Maximum bars held",
        10,
        1,
        500,
        "Exit at the close after this many bars in the trade.",
        unit="bars",
    ),
    directions_param(
        default="long",
        market_defaults={"us_equity": "long", "crypto_24x7": "both"},
        description=(
            "Which trades are allowed. Default: long only for stocks and ETFs, both for crypto."
        ),
    ),
)


def cross_check(values: dict[str, ParamValue]) -> list[str]:
    if not int(values["oversold"]) < int(values["exit_rsi"]) < int(values["overbought"]):
        return ["exit_rsi must lie strictly between oversold and overbought"]
    return []


def _side(values: dict[str, ParamValue], long: bool) -> dict:
    rsi = indicator("rsi", int(values["rsi_period"]))
    trend = int(values["trend_sma"])
    if long:
        entry = [cond(rsi, "crosses_above", const(int(values["oversold"])))]
    else:
        entry = [cond(rsi, "crosses_below", const(int(values["overbought"])))]
    if trend > 0:
        entry.append(cond(price("close"), ">" if long else "<", indicator("sma", trend)))
    exit_level = const(int(values["exit_rsi"]))
    return {
        "entry": entry,
        "stop": atr_stop(float(values["stop_atr"])),
        "exit_any": [cond(rsi, ">=" if long else "<=", exit_level)],
    }


def build(values: dict[str, ParamValue], market: MarketKind) -> StrategySpec:
    return StrategySpec.model_validate(
        {
            "name": "RSI Mean Reversion",
            "markets": ["us_equity", "crypto_24x7"],
            **sides(values["directions"], _side(values, True), _side(values, False)),
            "time_exit": {"session_end": False, "max_bars": int(values["max_bars"])},
        }
    )


STRATEGY = LibraryStrategy(
    id="rsi_mean_reversion",
    name="RSI Mean Reversion",
    summary="Buys oversold pullbacks in an uptrend and sells overbought rallies in a downtrend.",
    idea=(
        "The relative strength index measures how one-sided recent closes were. When it "
        "crosses back from an extreme while price is on the right side of a long moving "
        "average, the strategy bets that the pullback is over. It exits when the RSI returns "
        "to a middle level, on the stop, or after a maximum number of bars."
    ),
    works_when=(
        "Steady trends with regular, shallow pullbacks, where extremes in the RSI are "
        "temporary and the trend resumes."
    ),
    fails_when=(
        "Trend reversals and crashes, where oversold becomes more oversold, and flat markets "
        "where the trend filter flips back and forth."
    ),
    markets=("us_equity", "crypto_24x7"),
    timeframes=("15m", "30m", "1h", "4h", "1d"),
    parameters=PARAMETERS,
    build=build,
    cross_check=cross_check,
)
