from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_VERSION = "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MYCELIUM_", env_file=".env", extra="ignore")

    environment: Literal["development", "production"] = "development"
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5417"]
    )
    heartbeat_seconds: Annotated[float, Field(gt=0, le=60)] = 15.0
    dev_host: str = "127.0.0.1"
    dev_port: Annotated[int, Field(ge=1024, le=65535)] = 8417
    enable_yahoo: bool = False
    enable_binance_archive: bool = False
    enable_fake_runs: bool | None = None
    enable_docs: bool | None = None
    cache_dir: Path = BACKEND_DIR / ".cache" / "market"
    cache_max_mb: Annotated[float, Field(gt=0, le=100_000)] = 500.0
    cache_ttl_closed_days: Annotated[float, Field(gt=0, le=3_650)] = 30.0
    cache_ttl_live_seconds: Annotated[float, Field(gt=0, le=86_400)] = 60.0
    refresh_items: str = ""

    max_concurrent_runs: Annotated[int, Field(ge=1, le=64)] = 2
    queue_size: Annotated[int, Field(ge=0, le=1_000)] = 10
    run_timeout_seconds: Annotated[float, Field(gt=0, le=3_600)] = 120.0
    child_memory_mb: Annotated[int, Field(ge=0, le=65_536)] = 2_048
    retention_minutes: Annotated[float, Field(gt=0, le=1_440)] = 30.0
    max_retained_runs: Annotated[int, Field(ge=1, le=10_000)] = 200
    max_subscribers_per_run: Annotated[int, Field(ge=1, le=100)] = 4

    runs_per_hour_per_ip: Annotated[int, Field(ge=1, le=100_000)] = 12
    concurrent_runs_per_ip: Annotated[int, Field(ge=1, le=1_000)] = 2
    requests_per_minute_per_ip: Annotated[int, Field(ge=1, le=1_000_000)] = 240
    forwarded_hops: Annotated[int, Field(ge=0, le=5)] = 0

    max_json_bytes: Annotated[int, Field(ge=1_024, le=10_000_000)] = 64 * 1024
    max_csv_bytes: Annotated[int, Field(ge=1_024, le=100_000_000)] = 10 * 1024 * 1024
    max_result_bars: Annotated[int, Field(ge=100, le=2_000_000)] = 60_000
    max_result_trades: Annotated[int, Field(ge=10, le=1_000_000)] = 5_000

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def fake_runs_enabled(self) -> bool:
        if self.enable_fake_runs is None:
            return self.environment == "development"
        return self.enable_fake_runs

    @property
    def docs_enabled(self) -> bool:
        if self.enable_docs is None:
            return self.environment == "development"
        return self.enable_docs


@lru_cache
def get_settings() -> Settings:
    return Settings()
