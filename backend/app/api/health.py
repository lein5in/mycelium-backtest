from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.config import APP_VERSION

router = APIRouter()


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: str
    version: str


@router.get("/api/health")
def health() -> Health:
    return Health(status="ok", version=APP_VERSION)
