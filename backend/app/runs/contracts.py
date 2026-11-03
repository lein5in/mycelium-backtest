import json
from datetime import UTC, datetime
from pathlib import Path

from app.runs.events import run_event_json_schema, run_event_list_adapter
from app.runs.scenario import Scenario, scripted_steps
from app.runs.stream import materialise

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA_PATH = CONTRACTS_DIR / "run_events.schema.json"
SAMPLE_PATH = CONTRACTS_DIR / "run_events.sample.json"
SAMPLE_RUN_ID = "sample-run"
SAMPLE_STARTED_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _to_json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def schema_text() -> str:
    return _to_json(run_event_json_schema())


def sample_text() -> str:
    events = [
        event
        for _, event in materialise(
            scripted_steps(Scenario.SUCCESS), SAMPLE_RUN_ID, SAMPLE_STARTED_AT
        )
    ]
    return _to_json(run_event_list_adapter.dump_python(events, mode="json"))


def main() -> None:
    SCHEMA_PATH.write_text(schema_text(), encoding="utf-8", newline="\n")
    SAMPLE_PATH.write_text(sample_text(), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
