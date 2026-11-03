import json

from jsonschema import Draft202012Validator

from app.runs.contracts import SAMPLE_PATH, SCHEMA_PATH, sample_text, schema_text


def test_committed_schema_matches_models() -> None:
    assert SCHEMA_PATH.read_text(encoding="utf-8") == schema_text()


def test_committed_sample_matches_scripted_success() -> None:
    assert SAMPLE_PATH.read_text(encoding="utf-8") == sample_text()


def test_scripted_success_validates_against_schema() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    events = json.loads(sample_text())
    assert events
    for event in events:
        validator.validate(event)


def test_schema_rejects_unknown_event_type() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    bogus = {
        "type": "teleport",
        "schema_version": 1,
        "run_id": "x",
        "seq": 0,
        "ts": "2026-01-01T00:00:00Z",
    }
    assert not validator.is_valid(bogus)
