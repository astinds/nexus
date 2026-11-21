"""Storage abstraction: file bytes never live in PostgreSQL.

URIs are stable strings stored on items:
    local://<key>            LocalStorage (development, and tests)
    supabase://<bucket>/<key> SupabaseStorage (production free tier)
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel

SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,400}$")


class StorageError(RuntimeError):
    """Raised when a storage backend cannot fulfil a request."""


class StoredObject(BaseModel):
    uri: str
    key: str
    size: int
    content_type: str | None = None


def sanitize_key(key: str) -> str:
    """Reject traversal and control characters before anything touches a backend."""
    cleaned = (key or "").strip().lstrip("/")
    if not cleaned or ".." in cleaned.split("/") or not SAFE_KEY_RE.match(cleaned):
        raise StorageError(f"unsafe storage key: {key!r}")
    return cleaned


class BaseStorage(ABC):
    """Minimal contract every backend implements. Keep it boring."""

    name: str = "base"

    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject: ...

    @abstractmethod
    def get(self, uri: str) -> bytes: ...

    @abstractmethod
    def delete(self, uri: str) -> bool: ...

    @abstractmethod
    def exists(self, uri: str) -> bool: ...

    def url_for(self, uri: str, *, expires_in: int = 3600) -> str | None:
        """Optional direct URL for the browser. None means 'stream through the API'."""
        return None

    def health(self) -> dict[str, Any]:
        return {"backend": self.name, "ok": True, "detail": None}
