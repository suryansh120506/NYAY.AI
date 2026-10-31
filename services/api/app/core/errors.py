"""One error shape for every failure: {"code": "...", "detail": "...", "details": {...}}.

`code` matches the frontend's ApiErrorCode union (apps/web/lib/api/types.ts).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.schemas import ApiModel

from .logging import get_logger

log = get_logger("errors")


class ErrorResponse(ApiModel):
    code: str
    detail: str
    details: dict[str, Any] = Field(default_factory=dict)


class AppError(Exception):
    def __init__(self, code: str, status: int, detail: str = "", **details: Any) -> None:
        super().__init__(detail or code)
        self.code = code
        self.status = status
        self.detail = detail or code.replace("_", " ")
        self.details = details


def _json(status: int, code: str, detail: str, details: dict[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"code": code, "detail": detail, "details": details or {}}
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _json(exc.status, exc.code, exc.detail, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(p) for p in err.get("loc", ())[1:]) for err in exc.errors()]
        return _json(422, "invalid_request", "The request is not valid.", {"fields": ",".join(fields)})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "error"
        )
        return _json(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", path=request.url.path, error=type(exc).__name__)
        return _json(500, "unknown", "Something went wrong.")
