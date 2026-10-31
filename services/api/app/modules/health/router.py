from __future__ import annotations

import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.core.deps import ProvidersDep
from app.core.errors import AppError

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok"}


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request, providers: ProvidersDep) -> PlainTextResponse:
    """Prometheus scrape endpoint. With METRICS_TOKEN set, requires `Authorization: Bearer <token>`."""
    settings = providers.settings
    if not settings.metrics_enabled:
        raise AppError("not_found", 404)
    token = settings.metrics_token.get_secret_value()
    if token and not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
        raise AppError("unauthorized", 401)
    return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)


@router.get("/readyz")
async def readyz(providers: ProvidersDep) -> JSONResponse:
    """Readiness: Postgres, Redis and the vector store answer (brief §1.4)."""
    checks: dict[str, str] = {}
    try:
        async with providers.sessions() as db:
            await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = type(exc).__name__
    try:
        await providers.redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = type(exc).__name__
    try:
        await providers.vectors.query([0.0] * providers.settings.embedding_dim, candidate_ids=[], top_k=1)
        if providers.settings.vector_store == "pgvector":
            async with providers.sessions() as db:
                await db.execute(text("SELECT 1 FROM advocate_embeddings LIMIT 1"))
        checks["vector_store"] = "ok"
    except Exception as exc:
        checks["vector_store"] = type(exc).__name__
    ready = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if ready else 503, content={"status": "ok" if ready else "degraded", **checks}
    )
