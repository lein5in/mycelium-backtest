from collections.abc import Sequence
from datetime import datetime

import numpy as np

from app.honesty.config import HonestyConfig
from app.honesty.model import PeriodBlock, PeriodPart, settle


def block_count(trade_count: int, config: HonestyConfig) -> int:
    return min(config.period_blocks, trade_count // config.period_min_trades_per_block)


def evaluate(
    net_pnls: Sequence[float],
    exit_times: Sequence[datetime],
    config: HonestyConfig,
) -> PeriodPart:
    count = len(net_pnls)
    total = float(sum(net_pnls))
    blocks_wanted = max(1, block_count(count, config)) if count else 0
    insufficient = count < config.min_trades or blocks_wanted < 2
    values = np.asarray(net_pnls, dtype=np.float64)
    blocks: list[PeriodBlock] = []
    for index, positions in enumerate(np.array_split(np.arange(count), blocks_wanted or 1)):
        if positions.size == 0:
            continue
        first, last = int(positions[0]), int(positions[-1])
        net = float(values[first : last + 1].sum())
        blocks.append(
            PeriodBlock(
                index=index,
                first_trade=first,
                last_trade=last,
                trade_count=int(positions.size),
                start=exit_times[first],
                end=exit_times[last],
                net_pnl=net,
                share_of_profit=net / total if total > 0 else None,
            )
        )
    shares = [block.share_of_profit for block in blocks if block.share_of_profit is not None]
    max_share = max(shares) if shares else None
    positive = sum(1 for block in blocks if block.net_pnl > 0)
    positive_fraction = positive / len(blocks) if blocks else None
    if not blocks or total <= 0:
        status = "FAIL"
    elif len(blocks) < 2:
        status = "WARN"
    elif (
        max_share is not None and max_share > config.period_fail_share
    ) or positive_fraction < config.period_min_positive_fraction:
        status = "FAIL"
    elif max_share is not None and max_share > config.period_warn_share:
        status = "WARN"
    else:
        status = "PASS"
    return PeriodPart(
        status=settle(status, insufficient),
        insufficient_data=insufficient,
        blocks=blocks,
        max_share=max_share,
        positive_fraction=positive_fraction,
        total_net_pnl=total,
    )
