"""Error types and FastAPI exception handlers.

Every failure the client can trigger answers with one shape:
    {"error": {"code": "...", "message": "...", "detail": ...}}
so the frontend never has to guess between several error formats.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .db import DatabaseUnavailable

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        detail: object | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail

    def to_payload(self) -> dict:
        body: dict = {"code": self.code, "message": self.message}
        if self.detail is not None:
            body["detail"] = self.detail
        return {"error": body}


def bad_request(message: str, *, code: str = "bad_request", detail=None) -> ApiError:
    return ApiError(400, code, message, detail=detail)


def not_found(what: str, ident: object = None) -> ApiError:
    message = f"{what} not found" if ident is None else f"{what} {ident} not found"
    return ApiError(404, "not_found", message)


def conflict(message: str, *, detail=None) -> ApiError:
    return ApiError(409, "conflict", message, detail=detail)


def unprocessable(message: str, *, detail=None) -> ApiError:
    return ApiError(422, "unprocessable", message, detail=detail)


def service_unavailable(message: str, *, detail=None) -> ApiError:
    return ApiError(503, "service_unavailable", message, detail=detail)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(DatabaseUnavailable)
    async def _db_unavailable(_: Request, exc: DatabaseUnavailable) -> JSONResponse:
        log.warning("database unavailable: %s", exc)
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "database_unavailable",
                    "message": "The database is not reachable.",
                    "detail": str(exc),
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request body or parameters are invalid.",
                    "detail": [
                        {"loc": [str(part) for part in err.get("loc", [])],
                         "msg": err.get("msg", ""),
                         "type": err.get("type", "")}
                        for err in exc.errors()
                    ],
                }
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": "http_error", "message": str(exc.detail)}},
        )
