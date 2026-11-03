from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MYCELIUM_", env_file=".env", extra="ignore")

    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5417"]
    )
    heartbeat_seconds: Annotated[float, Field(gt=0, le=60)] = 15.0
    dev_host: str = "127.0.0.1"
    dev_port: Annotated[int, Field(ge=1024, le=65535)] = 8417

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
