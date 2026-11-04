from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import catalog, dev_runs, errors, health, runs
from app.api.guard import ApiGuard
from app.config import APP_VERSION, Settings, get_settings
from app.data.registry import DataRegistry
from app.jobs.limits import ClientKeys, RequestRate
from app.jobs.manager import JobManager
from app.runs.registry import RunRegistry


def create_app(settings: Settings | None = None, jobs: JobManager | None = None) -> FastAPI:
    settings = settings or get_settings()
    jobs = jobs or JobManager(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        jobs.warm()
        yield
        jobs.shutdown()

    docs = settings.docs_enabled
    app = FastAPI(
        title="Mycelium Backtest",
        version=APP_VERSION,
        docs_url="/api/docs" if docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.jobs = jobs
    app.state.providers = DataRegistry(settings).providers()
    app.state.run_registry = RunRegistry()
    errors.install(app)
    app.add_middleware(
        ApiGuard,
        settings=settings,
        keys=ClientKeys(settings.forwarded_hops),
        rate=RequestRate(settings.requests_per_minute_per_ip),
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "Last-Event-ID"],
        expose_headers=["Retry-After", "X-Request-ID"],
        allow_credentials=False,
    )
    app.include_router(health.router)
    app.include_router(catalog.router)
    app.include_router(runs.router)
    if settings.fake_runs_enabled:
        app.include_router(dev_runs.router)
    return app


app = create_app()
