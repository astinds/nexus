"""Storage factory. One place decides which backend the app uses."""

from __future__ import annotations

from ..config import Settings
from .base import BaseStorage, StorageError, StoredObject, sanitize_key  # noqa: F401
from .local import LocalStorage
from .supabase import SupabaseStorage


def build_storage(settings: Settings) -> BaseStorage:
    if settings.storage_backend == "supabase":
        return SupabaseStorage(
            settings.supabase_url,
            settings.supabase_service_key,
            settings.supabase_bucket,
        )
    return LocalStorage(settings.storage_root)


__all__ = [
    "BaseStorage",
    "LocalStorage",
    "StorageError",
    "StoredObject",
    "SupabaseStorage",
    "build_storage",
    "sanitize_key",
]
