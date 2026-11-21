"""NEXUS FastAPI application.

Run locally:  uvicorn app.main:app --reload --port 8000  (from backend/)
Deployed on Render Free: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import api_router
from .config import API_PREFIX, Settings, get_settings
from .db import Database
from .errors import install_error_handlers
from .storage import build_storage

log = logging.getLogger("nexus")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    for warning in settings.warnings():
        log.warning("configuration: %s", warning)
    if not settings.database_url:
        log.warning("DATABASE_URL is not set: data routes will answer 503")
    log.info("NEXUS %s ready (storage=%s)", __version__, settings.storage_backend)
    try:
        yield
    finally:
        app.state.db.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(levelname)s %(name)s: %(message)s",
    )

    app = FastAPI(
        title="NEXUS API",
        version=__version__,
        summary="Zero-cost personal information intelligence: capture, extract, search, export.",
        description=(
            "Every data route requires the single-user passcode when NEXUS_ACCESS_KEY is set; "
            "send it as the X-Nexus-Key header or unlock a session at /api/v1/auth/session. "
            "When NEXUS_ACCESS_KEY is unset the API runs in open development mode."
        ),
        docs_url="/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.storage = build_storage(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    install_error_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)

    @app.get("/", include_in_schema=False)
    def root() -> JSONResponse:
        return JSONResponse(
            {
                "name": "NEXUS",
                "version": __version__,
                "api": API_PREFIX,
                "docs": "/docs",
                "health": f"{API_PREFIX}/health",
            }
        )

    @app.get("/health", include_in_schema=False)
    def bare_health() -> JSONResponse:
        """Render's health check path; the real report is /api/v1/health."""
        return JSONResponse({"status": "ok"})

    return app


app = create_app()
