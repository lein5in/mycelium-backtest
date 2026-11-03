from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.base import LibraryStrategy
from app.strategies.blocks import cond, indicator, level_stop, linear, price, sides
from app.strategies.params import ParamValue, directions_param, float_param, int_param

ATR_PERIOD = 14

PARAMETERS = (
    int_param(
        "range_minutes",
        "Opening range",
        30,
        5,
        240,
        "Length of the opening range from the session open (crypto: from the session anchor).",
        step=5,
        unit="minutes",
    ),
    float_param(
        "min_range_atr",
        "Minimum range",
        0.5,
        0.0,
        5.0,
        0.1,
        "Skip sessions whose range is narrower than this multiple of ATR(14); 0 disables.",
        unit="x ATR(14)",
    ),
    float_param(
        "target_r",
        "Target",
        1.5,
        0.0,
        10.0,
        0.25,
        "Target distance as a multiple of the stop distance (R); 0 means no target.",
        unit="R",
    ),
    directions_param(),
)


def _side(minutes: int, min_range_atr: float, target_r: float, long: bool) -> dict:
    high = {"kind": "opening_range_high", "minutes": minutes}
    low = {"kind": "opening_range_low", "minutes": minutes}
    entry = [cond(price("close"), ">", high) if long else cond(price("close"), "<", low)]
    if min_range_atr > 0:
        entry.append(
            cond(
                linear((high, 1.0), (low, -1.0)),
                ">=",
                linear((indicator("atr", ATR_PERIOD), min_range_atr)),
            )
        )
    rules = {"entry": entry, "stop": level_stop(low if long else high)}
    if target_r > 0:
        rules["target"] = {"type": "r_multiple", "multiple": target_r}
    return rules


def build(values: dict[str, ParamValue], market: MarketKind) -> StrategySpec:
    minutes = int(values["range_minutes"])
    min_range_atr = float(values["min_range_atr"])
    target_r = float(values["target_r"])
    return StrategySpec.model_validate(
        {
            "name": "Opening Range Breakout",
            "markets": ["us_equity", "crypto_24x7"],
            **sides(
                values["directions"],
                _side(minutes, min_range_atr, target_r, long=True),
                _side(minutes, min_range_atr, target_r, long=False),
            ),
            "time_exit": {"session_end": True},
        }
    )


STRATEGY = LibraryStrategy(
    id="orb",
    name="Opening Range Breakout",
    summary="Trades the first close outside the range set in the first minutes of the session.",
    idea=(
        "The first part of a session often sets the high and low that the rest of the day "
        "reacts to. When price closes beyond that range, the strategy follows the move, with "
        "the stop on the other side of the range and an exit at the end of the session."
    ),
    works_when=(
        "Sessions with a clear direction after the open, such as news days or strong trends, "
        "where a breakout keeps going instead of reversing."
    ),
    fails_when=(
        "Range-bound or choppy sessions where price pokes out of the range and comes back, "
        "and very wide ranges that put the stop far away."
    ),
    markets=("us_equity", "crypto_24x7"),
    timeframes=("1m", "5m", "15m"),
    parameters=PARAMETERS,
    build=build,
)
