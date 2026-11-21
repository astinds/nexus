"""System routes: health, passcode session, and the API documentation banner."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Header, Response

from ..auth import (
    SESSION_COOKIE,
    _matches as _cookie_matches,
    clear_session_cookie,
    set_session_cookie,
)
from ..config import Settings, get_settings
from ..db import Database
from ..errors import ApiError
from ..extractors import available as available_extractors
from ..storage import BaseStorage
from .deps import get_database, get_storage_dep

router = APIRouter(tags=["system"])


@router.get("/health", summary="Liveness, dependency and configuration report")
def health(
    settings: Settings = Depends(get_settings),
    db: Database = Depends(get_database),
    storage: BaseStorage = Depends(get_storage_dep),
) -> dict:
    """Always answers 200 so cold-start banners and uptime checks work."""
    database = db.health()
    storage_health = storage.health()
    return {
        "status": "ok"
        if database.get("reachable") and storage_health.get("ok")
        else "degraded",
        "version": "1.0.0",
        "auth": {
            "mode": "dev_open" if settings.dev_open_access else "passcode",
            "dev_open_access": settings.dev_open_access,
        },
        "database": database,
        "storage": storage_health,
        "extractors": available_extractors(),
        "limits": {
            "max_upload_mb": settings.max_upload_mb,
            "page_size_default": 50,
            "page_size_max": 200,
        },
        "warnings": settings.warnings(),
    }


@router.post("/auth/session", summary="Unlock with the passcode (sets an HttpOnly cookie)")
def create_session(
    response: Response,
    x_nexus_key: str | None = Header(default=None, alias="X-Nexus-Key"),
    key: str | None = None,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Accepts the key in the header, or as the `key` query parameter."""
    import secrets

    from ..auth import session_token

    if settings.dev_open_access:
        set_session_cookie(response, settings)
        return {"mode": "dev_open", "authenticated": True}

    candidate = x_nexus_key or key
    if not candidate:
        raise ApiError(400, "missing_key", "Send the passcode as X-Nexus-Key.")

    access_key = settings.nexus_access_key.strip()
    if not secrets.compare_digest(candidate, access_key):
        raise ApiError(401, "invalid_key", "That passcode is not correct.")

    set_session_cookie(response, settings)
    return {"mode": "passcode", "authenticated": True, "token_hint": session_token(access_key)[:8]}


@router.get("/auth/session", summary="Is this client unlocked?")
def read_session(
    x_nexus_key: str | None = Header(default=None, alias="X-Nexus-Key"),
    nexus_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Never raises: the unlock screen asks this to decide what to render."""
    import secrets

    if settings.dev_open_access:
        return {"authenticated": True, "mode": "dev_open"}

    access_key = settings.nexus_access_key.strip()
    if x_nexus_key and secrets.compare_digest(x_nexus_key, access_key):
        return {"authenticated": True, "mode": "key"}
    if nexus_session and _cookie_matches(nexus_session, access_key):
        return {"authenticated": True, "mode": "key"}
    return {"authenticated": False, "mode": "locked"}


@router.delete("/auth/session", summary="Lock this client again")
def delete_session(response: Response) -> dict:
    clear_session_cookie(response)
    return {"authenticated": False}


@router.get("/meta", summary="Route map and conventions for integration work")
def meta() -> dict:
    return {
        "api": "/api/v1",
        "auth": {
            "header": "X-Nexus-Key",
            "cookie": "nexus_session",
            "session_endpoint": "/api/v1/auth/session",
        },
        "pagination": {"limit_param": "limit", "offset_param": "offset", "max_limit": 200},
        "error_shape": {"error": {"code": "string", "message": "string", "detail": "any|null"}},
        "triage_statuses": ["inbox", "reading", "processed", "evergreen", "cold_archive"],
        "source_formats": [
            "pdf",
            "docx",
            "markdown",
            "text",
            "csv",
            "json",
            "web_article",
            "note",
        ],
    }
