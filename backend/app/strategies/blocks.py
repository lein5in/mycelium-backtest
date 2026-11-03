from app.engine.spec import Comparator

Node = dict[str, object]


def price(kind: str) -> Node:
    return {"kind": kind}


def indicator(kind: str, period: int) -> Node:
    return {"kind": kind, "period": period}


def const(value: float) -> Node:
    return {"kind": "constant", "value": float(value)}


def linear(*terms: tuple[Node, float], constant: float = 0.0) -> Node:
    return {
        "kind": "linear",
        "terms": [{"operand": operand, "coef": float(coef)} for operand, coef in terms],
        "constant": float(constant),
    }


def cond(left: Node, op: Comparator, right: Node) -> Node:
    return {"left": left, "op": op, "right": right}


def atr_stop(multiple: float, period: int = 14) -> Node:
    return {"type": "atr", "period": period, "multiple": float(multiple)}


def level_stop(level: Node) -> Node:
    return {"type": "level", "level": level}


def sides(directions: object, long: Node, short: Node) -> dict[str, Node]:
    chosen: dict[str, Node] = {}
    if directions in ("long", "both"):
        chosen["long"] = long
    if directions in ("short", "both"):
        chosen["short"] = short
    return chosen
