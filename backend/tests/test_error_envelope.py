"""The client error envelope, including the last-resort 500 handler.

Live bug this pins: an uncaught `psycopg.ProgrammingError` in `/api/v1/ingest`
answered Starlette's bare "Exception in ASGI application" body, so the PWA could
only show "Request failed (500)." with no code and nothing to correlate.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_unhandled_error_returns_standard_envelope() -> None:
    settings = Settings(
        database_url="",
        nexus_access_key="",
        storage_backend="local",
        log_level="WARNING",
    )
    application = create_app(settings)

    @application.get("/__boom")
    def boom() -> dict:  # pragma: no cover - never returns
        raise RuntimeError("kaboom with internals")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/__boom")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert "logged" in body["error"]["message"].lower()
    # Internal detail stays in the server log, never in the response.
    assert "kaboom" not in response.text
    assert "RuntimeError" not in response.text
