from app.engine.sessions import MarketKind
from app.engine.spec import StrategySpec
from app.strategies.base import LibraryStrategy
from app.strategies.blocks import cond, const, level_stop, linear, price, sides
from app.strategies.params import ParamValue, directions_param, float_param

PREVIOUS_CLOSE = {"kind": "prev_session_close"}
SESSION_OPEN = {"kind": "session_open"}

PARAMETERS = (
    float_param(
        "min_gap_pct",
        "Minimum gap",
        0.5,
        0.1,
        10.0,
        0.1,
        "Smallest gap between the session open and the previous session close.",
        unit="% of previous close",
    ),
    float_param(
        "max_gap_pct",
        "Maximum gap",
        5.0,
        0.5,
        20.0,
        0.1,
        "Larger gaps are usually news-driven and are skipped.",
        unit="% of previous close",
    ),
    float_param(
        "stop_gap_fraction",
        "Stop beyond first bar",
        0.5,
        0.1,
        3.0,
        0.1,
        "Stop placed beyond the first bar's extreme by this fraction of the gap size.",
        unit="x gap",
    ),
    directions_param(),
)


def cross_check(values: dict[str, ParamValue]) -> list[str]:
    if float(values["min_gap_pct"]) >= float(values["max_gap_pct"]):
        return ["min_gap_pct must be smaller than max_gap_pct"]
    return []


def _side(values: dict[str, ParamValue], long: bool) -> dict:
    smallest = float(values["min_gap_pct"]) / 100.0
    largest = float(values["max_gap_pct"]) / 100.0
    fraction = float(values["stop_gap_fraction"])
    first_bar = cond({"kind": "bar_in_session"}, "<=", const(0))
    if long:
        entry = [
            first_bar,
            cond(SESSION_OPEN, "<=", linear((PREVIOUS_CLOSE, 1.0 - smallest))),
            cond(SESSION_OPEN, ">=", linear((PREVIOUS_CLOSE, 1.0 - largest))),
            cond(price("close"), "<", PREVIOUS_CLOSE),
        ]
        stop = linear((price("low"), 1.0), (PREVIOUS_CLOSE, -fraction), (SESSION_OPEN, fraction))
    else:
        entry = [
            first_bar,
            cond(SESSION_OPEN, ">=", linear((PREVIOUS_CLOSE, 1.0 + smallest))),
            cond(SESSION_OPEN, "<=", linear((PREVIOUS_CLOSE, 1.0 + largest))),
            cond(price("close"), ">", PREVIOUS_CLOSE),
        ]
        stop = linear((price("high"), 1.0), (SESSION_OPEN, fraction), (PREVIOUS_CLOSE, -fraction))
    return {
        "entry": entry,
        "stop": level_stop(stop),
        "target": {"type": "level", "level": PREVIOUS_CLOSE},
    }


def build(values: dict[str, ParamValue], market: MarketKind) -> StrategySpec:
    return StrategySpec.model_validate(
        {
            "name": "Gap Fade",
            "markets": ["us_equity"],
            **sides(values["directions"], _side(values, True), _side(values, False)),
            "time_exit": {"session_end": True},
        }
    )


STRATEGY = LibraryStrategy(
    id="gap_fade",
    name="Gap Fade",
    summary="Fades a moderate opening gap back toward the previous session's close.",
    idea=(
        "When a stock opens away from the previous close and the first bar does not close the "
        "gap, the strategy trades back toward that close. The target is the previous close, "
        "the stop sits beyond the first bar's extreme, and very large gaps are skipped because "
        "they usually follow news."
    ),
    works_when=(
        "Gaps caused by overnight noise or thin pre-market trading, without fresh "
        "information, in liquid stocks and ETFs."
    ),
    fails_when=(
        "Gaps driven by earnings, guidance or macro news, which tend to extend rather than "
        "fill, and very volatile opens that run through the stop."
    ),
    markets=("us_equity",),
    market_note=(
        "Gap Fade needs a session close and a separate next open; crypto trades 24/7, so "
        "there is no overnight gap to fade."
    ),
    timeframes=("1m", "5m", "15m", "30m"),
    parameters=PARAMETERS,
    build=build,
    cross_check=cross_check,
)
