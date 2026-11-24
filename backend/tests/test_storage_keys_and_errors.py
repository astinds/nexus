"""Object keys built from user filenames, and diagnosable storage failures.

Live bugs these pin:

1. `Influence The Psychology of Persuasion.pdf` answered
   "Could not persist the uploaded file.": the raw filename went into the object
   key and `sanitize_key` refused it because of the spaces. Renaming away the
   parentheses did not help, because the spaces were the problem.
2. A Supabase rejection logged nothing. The client saw a 502 and the upstream
   status/body were lost, so the cause had to be guessed from the dashboard.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from app.services.ingest import IngestService
from app.storage import LocalStorage, StorageError, object_key, sanitize_key, slugify_filename
from app.storage.supabase import SupabaseStorage


# --------------------------------------------------------------- key building
def test_slugify_replaces_spaces_and_parentheses() -> None:
    assert (
        slugify_filename("Influence The Psychology of Persuasion.pdf")
        == "Influence-The-Psychology-of-Persuasion.pdf"
    )
    assert slugify_filename("Influence (The Psychology).pdf") == "Influence-The-Psychology.pdf"


def test_slugify_keeps_extension_and_folds_accents() -> None:
    assert slugify_filename("Café résumé.docx") == "Cafe-resume.docx"


def test_slugify_neutralises_paths_and_empty_names() -> None:
    assert slugify_filename("../../etc/passwd.pdf") == "passwd.pdf"
    assert slugify_filename("") == "source"
    assert slugify_filename(None) == "source"
    assert slugify_filename("///") == "source"
    assert slugify_filename(".pdf") == "source.pdf"


def test_slugify_bounds_length() -> None:
    long_name = slugify_filename("a" * 400 + ".pdf")
    assert len(long_name) <= 80 + 1 + 12
    assert long_name.endswith(".pdf")


def test_object_key_always_passes_sanitize_key() -> None:
    for name in [
        "Influence The Psychology of Persuasion.pdf",
        "weird name (1) [draft];.pdf",
        "naïve — em dash.pdf",
        "no-extension",
        "",
    ]:
        key = object_key("ws/abc123", name)
        assert sanitize_key(key) == key


def test_sanitize_key_still_refuses_raw_spaces() -> None:
    """The guard is unchanged; only the key builder normalises."""
    with pytest.raises(StorageError):
        sanitize_key("ws/abc/Influence The Psychology of Persuasion.pdf")


# ------------------------------------------------------------ ingest call site
def test_store_source_accepts_filename_with_spaces(storage: LocalStorage) -> None:
    service = IngestService(storage, max_upload_bytes=1024 * 1024)
    uri = service._store_source(
        key_prefix="demo/abc123",
        filename="Influence The Psychology of Persuasion.pdf",
        data=b"%PDF-1.4 test",
        mime_type="application/pdf",
    )
    assert uri == "local://demo/abc123/Influence-The-Psychology-of-Persuasion.pdf"
    assert storage.get(uri) == b"%PDF-1.4 test"


def test_store_source_falls_back_when_no_filename(storage: LocalStorage) -> None:
    service = IngestService(storage, max_upload_bytes=1024 * 1024)
    uri = service._store_source(
        key_prefix="demo/abc123", filename=None, data=b"raw", mime_type=None
    )
    assert uri == "local://demo/abc123/source"


def test_store_source_logs_backend_reason(storage, caplog) -> None:
    class BrokenStorage(LocalStorage):
        def put(self, key, data, content_type=None):  # type: ignore[override]
            raise StorageError("supabase upload failed (403): InvalidJWT")

    service = IngestService(BrokenStorage(storage.root), max_upload_bytes=1024)
    with caplog.at_level(logging.ERROR):
        with pytest.raises(Exception) as excinfo:
            service._store_source(key_prefix="demo/x", filename="a.pdf", data=b"x", mime_type=None)
    assert getattr(excinfo.value, "status_code", None) == 502
    assert "InvalidJWT" in caplog.text


# ------------------------------------------------------- Supabase diagnostics
def _supabase() -> SupabaseStorage:
    return SupabaseStorage("https://example.supabase.co", "service-key", "nexus-files")


def test_upload_failure_names_upstream_reason(monkeypatch, caplog) -> None:
    request = httpx.Request("POST", "https://example.supabase.co/storage/v1/object/x")

    def fake_post(url, **kwargs):
        return httpx.Response(
            403,
            json={"statusCode": "403", "error": "InvalidJWT", "message": "bad key"},
            request=request,
        )

    monkeypatch.setattr("app.storage.supabase.httpx.post", fake_post)
    with caplog.at_level(logging.ERROR):
        with pytest.raises(StorageError) as excinfo:
            _supabase().put("ws/a.pdf", b"data", "application/pdf")

    message = str(excinfo.value)
    assert "403" in message
    assert "InvalidJWT" in message
    assert "service-key" not in message  # never leak the service key
    assert "supabase upload rejected" in caplog.text
    assert "InvalidJWT" in caplog.text


def test_upload_timeout_becomes_a_storage_error(monkeypatch, caplog) -> None:
    def fake_post(url, **kwargs):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr("app.storage.supabase.httpx.post", fake_post)
    with caplog.at_level(logging.ERROR):
        with pytest.raises(StorageError) as excinfo:
            _supabase().put("ws/a.pdf", b"data", "application/pdf")
    assert "ConnectTimeout" in str(excinfo.value)
    assert "service-key" not in str(excinfo.value)


def test_upload_success_still_returns_uri(monkeypatch) -> None:
    def fake_post(url, **kwargs):
        assert kwargs["headers"]["x-upsert"] == "true"
        assert kwargs["headers"]["Content-Type"] == "application/pdf"
        assert url.endswith("/storage/v1/object/nexus-files/ws/a.pdf")
        return httpx.Response(200, json={"Key": "ws/a.pdf"})

    monkeypatch.setattr("app.storage.supabase.httpx.post", fake_post)
    stored = _supabase().put("ws/a.pdf", b"data", "application/pdf")
    assert stored.uri == "supabase://nexus-files/ws/a.pdf"
    assert stored.size == 4
