import math


def money(value: float) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}{abs(value):,.2f}"


def percent(share: float | None) -> str:
    if share is None:
        return "n/a"
    return f"{share * 100:.0f}%"


def factor(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2f}"


def split_index(count: int, fraction: float) -> int:
    return math.floor(count * fraction)


def plural(count: int, word: str) -> str:
    return f"{count:,} {word}" if count == 1 else f"{count:,} {word}s"
