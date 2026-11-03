from collections.abc import Iterable, Mapping

import numpy as np

from app.engine.signals import SidePlan, SignalPlan

Entry = tuple[float, float | None]


def _side(
    size: int,
    entries: Mapping[int, Entry],
    exits: Iterable[int],
    stop_kind: str,
    moving_target: np.ndarray | None,
) -> SidePlan | None:
    if not entries:
        return None
    entry = np.zeros(size, dtype=bool)
    stop = np.full(size, np.nan)
    target = np.full(size, np.nan)
    for index, (stop_value, target_value) in entries.items():
        entry[index] = True
        stop[index] = stop_value
        if target_value is not None:
            target[index] = target_value
    has_target = any(value is not None for _, value in entries.values())
    exit_mask = np.zeros(size, dtype=bool)
    exit_mask[list(exits)] = True
    if moving_target is not None:
        target_kind, target_value = "moving", moving_target
    elif has_target:
        target_kind, target_value = "level", target
    else:
        target_kind, target_value = "none", None
    return SidePlan(
        entry=entry,
        stop_kind=stop_kind,
        stop_value=stop,
        target_kind=target_kind,
        target_value=target_value,
        exit=exit_mask,
    )


def scripted_plan(
    size: int,
    longs: Mapping[int, Entry] | None = None,
    shorts: Mapping[int, Entry] | None = None,
    long_exits: Iterable[int] = (),
    short_exits: Iterable[int] = (),
    stop_kind: str = "level",
    session_end_exit: bool = False,
    max_bars: int | None = None,
    warmup: int = 0,
    moving_target: np.ndarray | None = None,
) -> SignalPlan:
    return SignalPlan(
        long=_side(size, longs or {}, long_exits, stop_kind, moving_target),
        short=_side(size, shorts or {}, short_exits, stop_kind, moving_target),
        warmup=warmup,
        session_end_exit=session_end_exit,
        max_bars=max_bars,
    )
