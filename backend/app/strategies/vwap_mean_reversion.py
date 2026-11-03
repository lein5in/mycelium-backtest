from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.base import LibraryStrategy
from app.strategies.blocks import atr_stop, cond, const, indicator, linear, price, sides
from app.strategies.params import ParamValue, directions_param, float_param, int_param

PARAMETERS = (
    float_param(
        "threshold_std",
        "Deviation threshold",
        2.0,
        0.5,
        5.0,
        0.1,
        "Enter when the close is this many standard deviations away from the session VWAP.",
        unit="std",
    ),
    float_param(
        "stop_atr",
        "Stop distance",
        1.5,
        0.25,
        10.0,
        0.25,
        "Stop distance from the entry as a multiple of ATR(14).",
        unit="x ATR(14)",
    ),
    int_param(
        "skip_minutes",
        "Skip after open",
        30,
        0,
        240,
        "No entries during the first minutes of the session, while the VWAP is still unstable.",
        step=5,
        unit="minutes",
    ),
    int_param(
        "std_window",
        "Deviation window",
        30,
        5,
        500,
        "Number of bars used for the standard deviation of the distance to the VWAP.",
        unit="bars",
    ),
    directions_param(),
)


def _side(values: dict[str, ParamValue], long: bool) -> dict:
    vwap = {"kind": "vwap"}
    deviation = indicator("vwap_dev_std", int(values["std_window"]))
    threshold = float(values["threshold_std"])
    band = linear((vwap, 1.0), (deviation, -threshold if long else threshold))
    return {
        "entry": [
            cond(price("close"), "<" if long else ">", band),
            cond({"kind": "minutes_since_open"}, ">=", const(int(values["skip_minutes"]))),
        ],
        "stop": atr_stop(float(values["stop_atr"])),
        "target": {"type": "moving", "level": vwap},
    }


def build(values: dict[str, ParamValue], market: MarketKind) -> StrategySpec:
    return StrategySpec.model_validate(
        {
            "name": "VWAP Mean Reversion",
            "markets": ["us_equity", "crypto_24x7"],
            **sides(values["directions"], _side(values, True), _side(values, False)),
            "time_exit": {"session_end": True},
        }
    )


STRATEGY = LibraryStrategy(
    id="vwap_mean_reversion",
    name="VWAP Mean Reversion",
    summary="Fades stretched moves away from the session VWAP and targets a return to it.",
    idea=(
        "The volume-weighted average price of the session is where most of the day's volume "
        "traded. When the close moves unusually far from it, measured in standard deviations "
        "of recent distances, the strategy bets on a move back toward the VWAP, which is also "
        "the moving target."
    ),
    works_when=(
        "Calm, two-sided sessions where price oscillates around a stable VWAP and stretched "
        "moves are driven by short-lived order imbalances."
    ),
    fails_when=(
        "Trend days and news-driven sessions, where price keeps moving away from the VWAP and "
        "the stretch is the start of a move rather than its end."
    ),
    markets=("us_equity", "crypto_24x7"),
    timeframes=("1m", "5m", "15m"),
    parameters=PARAMETERS,
    build=build,
)
