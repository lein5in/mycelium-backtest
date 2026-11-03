from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, runs
from app.config import Settings, get_settings
from app.runs.registry import RunRegistry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Mycelium Backtest", version="0.1.0")
    app.state.settings = settings
    app.state.run_registry = RunRegistry()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(runs.router)
    return app


app = create_app()
