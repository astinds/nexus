"""API package. Routers are mounted in app.main under /api/v1."""

from __future__ import annotations

from fastapi import APIRouter

from . import catalog, ingest, items, studio, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(catalog.router)
api_router.include_router(items.router)
api_router.include_router(studio.router)
api_router.include_router(ingest.router)

__all__ = ["api_router"]
