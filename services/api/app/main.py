"""Nyay.ai API: one FastAPI app, one package per module (brief §1.1). Run: `uv run uvicorn app.main:app`."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings
from app.core.errors import ErrorResponse, install_error_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import RequestContextMiddleware
from app.core.providers import Providers, build_providers
from app.core.redis import get_redis
from app.db.session import get_sessionmaker
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.health.router import router as health_router
from app.modules.news.router import router as news_router
from app.modules.parakh.router import router as parakh_router
from app.modules.payments.router import router as payments_router
from app.modules.samvaad.engine import BillingEngine
from app.modules.samvaad.gateway import router as samvaad_ws_router
from app.modules.samvaad.router import router as samvaad_router
from app.modules.saransh.router import router as saransh_router
from app.modules.users.router import router as users_router
from app.modules.wallet.router import router as wallet_router

log = get_logger("app")


class ConfigurationError(RuntimeError):
    pass


def create_app(settings: Settings | None = None, providers: Providers | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        owned = providers is None
        if owned:
            missing = settings.missing_required()
            if missing:
                raise ConfigurationError(
                    "Missing configuration: "
                    + ", ".join(missing)
                    + ". Copy .env.example to .env and fill it in."
                )
            app.state.providers = build_providers(settings, redis=get_redis(), sessions=get_sessionmaker())
        else:
            app.state.providers = providers
        engine: BillingEngine | None = None
        if owned:
            app.state.providers.hub.start_relay()
            if settings.billing_runner == "api":
                engine = BillingEngine(app.state.providers)
                engine.start()
        log.info(
            "app.started",
            env=settings.env,
            llm=app.state.providers.llm.name,
            payments=settings.payment_provider,
            vector_store=settings.vector_store,
        )
        try:
            yield
        finally:
            if engine is not None:
                await engine.stop()
            if owned:
                await app.state.providers.aclose()

    app = FastAPI(
        title="Nyay.ai API",
        version="0.3.0",
        lifespan=lifespan,
        responses={
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            500: {"model": ErrorResponse},
        },
        docs_url="/docs" if settings.is_dev else None,
        redoc_url=None,
    )
    app.add_middleware(RequestContextMiddleware, default_rule=settings.rate_limit_default)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origin.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    install_error_handlers(app)
    for router in (
        health_router,
        auth_router,
        users_router,
        wallet_router,
        payments_router,
        parakh_router,
        news_router,
        admin_router,
        samvaad_router,
        samvaad_ws_router,
        saransh_router,
    ):
        app.include_router(router)
    return app


app = create_app()
