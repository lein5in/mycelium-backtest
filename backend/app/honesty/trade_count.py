from app.honesty.config import HonestyConfig
from app.honesty.model import CheckResult, settle
from app.honesty.text import plural, split_index


def evaluate(count: int, config: HonestyConfig) -> CheckResult:
    first = split_index(count, config.split_fraction)
    second = count - first
    insufficient = min(first, second) < config.min_trades_per_split
    if count >= config.trade_count_pass:
        status = "PASS"
        headline = f"{plural(count, 'trade')}: enough to measure"
    elif count >= config.trade_count_warn:
        status = "WARN"
        headline = f"Only {plural(count, 'trade')}: results can move a lot with a few trades"
    else:
        status = "FAIL"
        headline = f"Only {plural(count, 'trade')}: too few to judge"
    split_text = (
        f"The chronological split gives {first:,} trades in the first "
        f"{config.split_fraction * 100:g}% and {second:,} in the last "
        f"{(1 - config.split_fraction) * 100:g}%."
    )
    if insufficient:
        split_text += (
            f" At least {config.min_trades_per_split} per part are needed, so the split "
            "results are flagged as insufficient."
        )
    return CheckResult(
        id="trade_count",
        status=settle(status, insufficient),
        headline=headline,
        detail=(
            f"{plural(count, 'trade')} in total ({config.trade_count_pass} or more passes, "
            f"fewer than {config.trade_count_warn} fails). {split_text}"
        ),
        insufficient_data=insufficient,
        measured={"trade_count": count, "first_part_trades": first, "last_part_trades": second},
        thresholds={
            "pass_min_trades": config.trade_count_pass,
            "warn_min_trades": config.trade_count_warn,
            "min_trades_per_split": config.min_trades_per_split,
            "split_fraction": config.split_fraction,
        },
    )
