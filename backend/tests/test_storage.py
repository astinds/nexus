"""Storage adapters: local round-trip, traversal safety, Supabase URI parsing."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.storage import LocalStorage, StorageError, build_storage, sanitize_key
from app.storage.supabase import SupabaseStorage


def test_local_put_get_exists_delete(storage: LocalStorage) -> None:
    stored = storage.put("ws/doc.txt", b"hello world", "text/plain")
    assert stored.uri == "local://ws/doc.txt"
    assert stored.size == 11
    assert storage.exists(stored.uri)
    assert storage.get(stored.uri) == b"hello world"
    assert storage.delete(stored.uri) is True
    assert storage.exists(stored.uri) is False
    assert storage.delete(stored.uri) is False


def test_local_get_missing_raises(storage: LocalStorage) -> None:
    with pytest.raises(StorageError):
        storage.get("local://nope.txt")


def test_local_rejects_traversal(storage: LocalStorage) -> None:
    with pytest.raises(StorageError):
        storage.put("../escape.txt", b"x")
    with pytest.raises(StorageError):
        storage.get("local://../../etc/passwd")


def test_local_rejects_foreign_scheme(storage: LocalStorage) -> None:
    with pytest.raises(StorageError):
        storage.get("supabase://bucket/key")


def test_sanitize_key_rules() -> None:
    assert sanitize_key("/a/b.txt") == "a/b.txt"
    with pytest.raises(StorageError):
        sanitize_key("")
    with pytest.raises(StorageError):
        sanitize_key("a/../../b")
    with pytest.raises(StorageError):
        sanitize_key("bad key with spaces")


def test_local_health_reports_root(storage: LocalStorage) -> None:
    health = storage.health()
    assert health["backend"] == "local"
    assert health["ok"] is True


def test_build_storage_respects_backend_setting(tmp_path) -> None:
    local = build_storage(
        Settings(storage_backend="local", local_storage_dir=str(tmp_path / "s"))
    )
    assert isinstance(local, LocalStorage)

    cloud = build_storage(
        Settings(
            storage_backend="supabase",
            supabase_url="https://example.supabase.co",
            supabase_service_key="service-key",
        )
    )
    assert isinstance(cloud, SupabaseStorage)


def test_supabase_storage_requires_credentials() -> None:
    with pytest.raises(StorageError):
        SupabaseStorage("", "", "bucket")


def test_supabase_uri_round_trip() -> None:
    storage = SupabaseStorage("https://example.supabase.co", "key", "nexus-files")
    assert storage._object_url("ws/a.pdf").endswith("/storage/v1/object/nexus-files/ws/a.pdf")
    bucket, key = SupabaseStorage._split_uri("supabase://nexus-files/ws/a.pdf")
    assert (bucket, key) == ("nexus-files", "ws/a.pdf")
    with pytest.raises(StorageError):
        SupabaseStorage._split_uri("local://ws/a.pdf")


def test_config_warns_when_supabase_backend_lacks_credentials() -> None:
    warnings = Settings(storage_backend="supabase", supabase_url="", supabase_service_key="").warnings()
    assert any("SUPABASE_URL" in warning for warning in warnings)


def test_config_rejects_unknown_backend() -> None:
    with pytest.raises(Exception):
        Settings(storage_backend="s3")
