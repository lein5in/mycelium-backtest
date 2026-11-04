from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MYCELIUM_", env_file=".env", extra="ignore")

    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5417"]
    )
    heartbeat_seconds: Annotated[float, Field(gt=0, le=60)] = 15.0
    dev_host: str = "127.0.0.1"
    dev_port: Annotated[int, Field(ge=1024, le=65535)] = 8417
    enable_yahoo: bool = False
    enable_binance_archive: bool = False
    cache_dir: Path = BACKEND_DIR / ".cache" / "market"
    cache_max_mb: Annotated[float, Field(gt=0, le=100_000)] = 500.0
    cache_ttl_closed_days: Annotated[float, Field(gt=0, le=3_650)] = 30.0
    cache_ttl_live_seconds: Annotated[float, Field(gt=0, le=86_400)] = 60.0
    refresh_items: str = ""

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
