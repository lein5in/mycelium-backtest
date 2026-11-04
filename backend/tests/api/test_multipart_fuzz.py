import random
import time

import pytest

from app.api.multipart import MAX_HEADER_BYTES, Part, parse
from app.errors import ApiError
from tests.api.csv_files import multipart

SEED = 20261104
CASES_PER_KIND = 50
BOUNDARY = "fuzzboundary7"


def valid_body(rng: random.Random) -> tuple[bytes, str]:
    fields = {
        f"field{i}": rng.choice(["", "x", '{"a": 1}', "é" * 3]) for i in range(rng.randint(1, 3))
    }
    content = rng.randbytes(rng.randint(0, 200)) if rng.random() < 0.7 else None
    return multipart(fields, content, BOUNDARY)


def random_bytes(rng: random.Random) -> tuple[bytes, str]:
    return rng.randbytes(rng.randint(0, 4_096)), f"multipart/form-data; boundary={BOUNDARY}"


def truncated(rng: random.Random) -> tuple[bytes, str]:
    body, content_type = valid_body(rng)
    return body[: rng.randint(0, len(body) - 3)], content_type


def missing_boundary(rng: random.Random) -> tuple[bytes, str]:
    body, _ = valid_body(rng)
    content_type = rng.choice(
        [
            "multipart/form-data",
            "multipart/form-data; boundary=",
            'multipart/form-data; boundary=""',
            f"text/plain; boundary={BOUNDARY}",
            "",
            "multipart/form-data; boundary=" + "b" * 200,
            f"multipart/form-data; boundary=other{rng.randint(0, 999)}",
        ]
    )
    return body, content_type


def huge_header(rng: random.Random) -> tuple[bytes, str]:
    filler = "X-Filler: " + "h" * rng.randint(MAX_HEADER_BYTES, MAX_HEADER_BYTES * 8)
    head = (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"\r\n{filler}\r\n\r\n'.encode()
    )
    return head + b"data\r\n" + f"--{BOUNDARY}--\r\n".encode(), (
        f"multipart/form-data; boundary={BOUNDARY}"
    )


def nested_boundary(rng: random.Random) -> tuple[bytes, str]:
    inner, _ = multipart({"inner": "v"}, rng.randbytes(20), BOUNDARY)
    depth = rng.randint(1, 4)
    body = inner
    for _ in range(depth):
        body = (
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"\r\n\r\n'.encode()
            + body
            + f"\r\n--{BOUNDARY}--\r\n".encode()
        )
    return body, f"multipart/form-data; boundary={BOUNDARY}"


def mutated(rng: random.Random) -> tuple[bytes, str]:
    body, content_type = valid_body(rng)
    data = bytearray(body)
    for _ in range(rng.randint(1, 8)):
        position = rng.randrange(len(data))
        action = rng.randrange(3)
        if action == 0:
            data[position] = rng.randrange(256)
        elif action == 1:
            del data[position]
        else:
            data.insert(position, rng.choice(b'\r\n-"; '))
    return bytes(data), content_type


ALWAYS_INVALID = (random_bytes, truncated, missing_boundary, huge_header, nested_boundary)
KINDS = (*ALWAYS_INVALID, mutated)


def check(body: bytes, content_type: str, must_fail: bool) -> None:
    try:
        parts = parse(body, content_type)
    except ApiError as error:
        assert error.code == "invalid_request"
        return
    assert not must_fail
    assert all(isinstance(part, Part) for part in parts.values())


@pytest.mark.parametrize("kind", KINDS, ids=lambda kind: kind.__name__)
def test_parser_rejects_malformed_bodies_with_the_normal_error(kind):
    rng = random.Random(f"{SEED}-{kind.__name__}")
    started = time.perf_counter()
    for _ in range(CASES_PER_KIND):
        body, content_type = kind(rng)
        check(body, content_type, must_fail=kind in ALWAYS_INVALID)
    assert time.perf_counter() - started < 5


def test_valid_bodies_still_parse():
    rng = random.Random(SEED)
    for _ in range(CASES_PER_KIND):
        body, content_type = valid_body(rng)
        assert isinstance(parse(body, content_type), dict)
