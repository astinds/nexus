"""Single-user passcode gate.

Three ways in, in priority order:
  1. NEXUS_ACCESS_KEY unset  -> open development access, mode="dev_open".
  2. `X-Nexus-Key: <key>`    -> for scripts, curl, webhooks and the smoke test.
  3. HttpOnly session cookie -> set by POST /api/v1/auth/session after the user
     types the passcode once in the UI.

The cookie never contains the passcode: it holds an HMAC of a fixed label keyed
by the passcode, so a leaked cookie does not leak the passcode.

Isolation contract: routers depend on `require_access`, never on the settings
object directly. Swapping in Supabase Auth + RLS later means replacing this one
dependency.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Cookie, Depends, Header, Response
from pydantic import BaseModel

from .config import Settings, get_settings
from .errors import ApiError

SESSION_COOKIE = "nexus_session"
_SESSION_LABEL = b"nexus-session-v1"


def session_token(access_key: str) -> str:
    """Deterministic HMAC used as the cookie value (never the passcode itself)."""
    return hmac.new(access_key.encode("utf-8"), _SESSION_LABEL, hashlib.sha256).hexdigest()


def _matches(candidate: str, access_key: str) -> bool:
    return secrets.compare_digest(candidate, session_token(access_key))


class AuthContext(BaseModel):
    mode: str  # "dev_open" | "key"
    authenticated: bool


def require_access(
    x_nexus_key: str | None = Header(default=None, alias="X-Nexus-Key"),
    nexus_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    settings: Settings = Depends(get_settings),
) -> AuthContext:
    """FastAPI dependency guarding every data route."""
    if settings.dev_open_access:
        return AuthContext(mode="dev_open", authenticated=True)

    access_key = settings.nexus_access_key.strip()
    if x_nexus_key and secrets.compare_digest(x_nexus_key, access_key):
        return AuthContext(mode="key", authenticated=True)
    if nexus_session and _matches(nexus_session, access_key):
        return AuthContext(mode="key", authenticated=True)

    raise ApiError(
        401,
        "unauthorized",
        "NEXUS is locked. Send X-Nexus-Key or unlock a session first.",
    )


def set_session_cookie(response: Response, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token(settings.nexus_access_key.strip()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=60 * 60 * 24 * 30,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Expire the cookie at the epoch.

    `delete_cookie` alone sets Max-Age=0 with `expires=<now>`, which some HTTP
    clients (including httpx) keep in their jar. An explicit epoch date is
    unambiguous for browsers and tests alike.
    """
    response.set_cookie(
        key=SESSION_COOKIE,
        value="",
        max_age=0,
        expires="Thu, 01 Jan 1970 00:00:00 GMT",
        path="/",
        httponly=True,
        samesite="lax",
    )
