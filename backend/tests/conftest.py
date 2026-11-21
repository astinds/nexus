"""Shared test fixtures.

Tests never touch a real database: repository SQL is exercised through the query
builders, and API behaviour through dependency overrides. The one exception is
`test_migrations_sql.py`, which statically validates the SQL files.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings, get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def settings() -> Settings:
    """Deterministic settings: no database, open dev access, temp storage."""
    return Settings(
        database_url="",
        nexus_access_key="",
        storage_backend="local",
        local_storage_dir=".nexus-storage",
        max_upload_mb=5,
        log_level="WARNING",
    )


@pytest.fixture()
def locked_settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url="",
        nexus_access_key="a-very-long-test-passcode",
        storage_backend="local",
        local_storage_dir=str(tmp_path / "storage"),
        log_level="WARNING",
    )


@pytest.fixture()
def app(settings: Settings):
    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return application


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def locked_client(locked_settings: Settings):
    from fastapi.testclient import TestClient

    application = create_app(locked_settings)
    application.dependency_overrides[get_settings] = lambda: locked_settings
    with TestClient(application) as test_client:
        yield test_client


@pytest.fixture()
def storage(tmp_path: Path):
    from app.storage import LocalStorage

    return LocalStorage(tmp_path / "files")
