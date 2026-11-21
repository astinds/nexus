"""FastAPI dependencies: database cursor, settings, storage and services.

Routers never touch psycopg directly. One request gets one connection; the
connection commits when the response is produced and rolls back on an exception,
so a failed request cannot leave half-written rows behind.
"""

from __future__ import annotations

from typing import Iterator

import psycopg
from fastapi import Depends, Request

from ..config import Settings, get_settings
from ..db import Database
from ..extractors import available as available_extractors
from ..services.ingest import IngestService
from ..storage import BaseStorage, build_storage


def get_database(request: Request) -> Database:
    return request.app.state.db


def get_storage_dep(request: Request) -> BaseStorage:
    return request.app.state.storage


def get_cursor(
    request: Request, db: Database = Depends(get_database)
) -> Iterator[psycopg.Cursor]:
    with db.connection() as connection:
        with connection.cursor() as cursor:
            yield cursor


def get_ingest_service(
    settings: Settings = Depends(get_settings),
    storage: BaseStorage = Depends(get_storage_dep),
) -> IngestService:
    return IngestService(
        storage,
        max_upload_bytes=settings.max_upload_bytes,
        web_timeout_seconds=settings.web_fetch_timeout_seconds,
    )


def extractor_inventory() -> list[dict[str, object]]:
    return available_extractors()


__all__ = [
    "extractor_inventory",
    "get_cursor",
    "get_database",
    "get_ingest_service",
    "get_settings",
    "get_storage_dep",
    "build_storage",
]
