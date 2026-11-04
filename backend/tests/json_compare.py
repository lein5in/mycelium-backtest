import json
import math

RELATIVE_TOLERANCE = 1e-9
ABSOLUTE_TOLERANCE = 1e-12


def assert_json_text_close(actual_text: str, expected_text: str) -> None:
    assert_json_close(json.loads(actual_text), json.loads(expected_text), "$")


def assert_json_close(actual, expected, path: str) -> None:
    if isinstance(expected, dict):
        assert isinstance(actual, dict), path
        assert list(actual) == list(expected), f"{path}: keys differ"
        for key in expected:
            assert_json_close(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), path
        assert len(actual) == len(expected), f"{path}: length differs"
        for index, (a, e) in enumerate(zip(actual, expected, strict=True)):
            assert_json_close(a, e, f"{path}[{index}]")
    elif isinstance(expected, float) and not isinstance(expected, bool):
        assert isinstance(actual, float), f"{path}: {actual!r} is not a float"
        assert math.isclose(
            actual, expected, rel_tol=RELATIVE_TOLERANCE, abs_tol=ABSOLUTE_TOLERANCE
        ), f"{path}: {actual!r} != {expected!r}"
    else:
        assert type(actual) is type(expected), f"{path}: type differs"
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"
