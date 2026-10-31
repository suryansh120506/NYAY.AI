from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .errors import AppError
from .logging import get_logger
from .memlimit import limiter

log = get_logger("http")

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # The API serves JSON only.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


_UNLIMITED = ("/healthz", "/readyz", "/metrics", "/v1/webhooks/")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Request id (X-Request-ID in and out), security headers, the default per-IP rate limit (in memory, no Redis
    cost), and one access log line without query strings."""

    def __init__(self, app: object, default_rule: str = "120/60") -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.default_rule = default_rule

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        path = request.url.path
        if request.method != "OPTIONS" and not path.startswith(_UNLIMITED):
            ip = request.client.host if request.client else "unknown"
            try:
                limiter.check(f"ip:{ip}", self.default_rule)
            except AppError as exc:
                limited = JSONResponse(
                    status_code=429,
                    content={"code": exc.code, "detail": exc.detail, "details": exc.details},
                    headers={"Retry-After": str(exc.details.get("retry_after", 1))},
                )
                limited.headers["X-Request-ID"] = request_id
                structlog.contextvars.unbind_contextvars("request_id")
                return limited
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers["X-Request-ID"] = request_id
        for name, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path not in ("/healthz", "/readyz"):
            log.info(
                "request",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                ms=round((time.perf_counter() - started) * 1000, 1),
            )
        return response
