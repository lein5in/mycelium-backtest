import json
from pathlib import Path

from app.config import Settings
from app.main import create_app

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"
OPENAPI_PATH = CONTRACTS_DIR / "openapi.json"


def openapi_text() -> str:
    settings = Settings(environment="production", enable_fake_runs=False)
    schema = create_app(settings).openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> None:
    OPENAPI_PATH.write_text(openapi_text(), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
