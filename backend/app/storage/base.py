"""Storage abstraction: file bytes never live in PostgreSQL.

URIs are stable strings stored on items:
    local://<key>            LocalStorage (development, and tests)
    supabase://<bucket>/<key> SupabaseStorage (production free tier)
"""

from __future__ import annotations

import re
import unicodedata
from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel

SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,400}$")

# A filename is user data, not a URI fragment. Anything outside this class is
# folded to "-" before the key reaches a backend.
UNSAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
MAX_STEM_LENGTH = 80


class StorageError(RuntimeError):
    """Raised when a storage backend cannot fulfil a request."""


class StoredObject(BaseModel):
    uri: str
    key: str
    size: int
    content_type: str | None = None


def sanitize_key(key: str) -> str:
    """Reject traversal and control characters before anything touches a backend.

    This is a guard, not a formatter: it refuses what it does not recognise.
    User-supplied filenames go through `object_key` first, which normalises them
    into something this guard accepts.
    """
    cleaned = (key or "").strip().lstrip("/")
    if not cleaned or ".." in cleaned.split("/") or not SAFE_KEY_RE.match(cleaned):
        raise StorageError(f"unsafe storage key: {key!r}")
    return cleaned


def slugify_filename(filename: str | None, *, fallback: str = "source") -> str:
    """Fold a real-world filename into a key segment a backend will accept.

    "Influence The Psychology of Persuasion.pdf" is an ordinary upload, but the
    space in it fails `SAFE_KEY_RE`, and a URL-encoded name would still need
    escaping in the object URL. Normalise instead of rejecting: keep the stem
    and extension recognisable, drop everything that needs escaping.
    """
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not name:
        return fallback
    # Decompose accents ("Café" -> "Cafe") rather than dropping the character.
    name = unicodedata.normalize("NFKD", name)
    name = "".join(char for char in name if not unicodedata.combining(char))
    stem, dot, suffix = name.rpartition(".")
    if not dot:
        stem, suffix = name, ""
    suffix = UNSAFE_NAME_RE.sub("", suffix.lower())[:12]
    stem = UNSAFE_NAME_RE.sub("-", stem)
    stem = re.sub(r"-{2,}", "-", stem).strip("-._")[:MAX_STEM_LENGTH].strip("-._")
    if not stem:
        stem = fallback
    return f"{stem}.{suffix}" if suffix else stem


def object_key(prefix: str, filename: str | None = None, *, fallback: str = "source") -> str:
    """Build `<prefix>/<safe filename>` for a storage backend.

    The prefix carries the workspace slug and a content hash, so two uploads
    with the same slugified name never collide on identical bytes: those are
    deduplicated before this point.
    """
    return f"{sanitize_key(prefix)}/{slugify_filename(filename, fallback=fallback)}"


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
