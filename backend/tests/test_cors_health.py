"""Health and CORS contract.

The Render cold start is the reason this file exists: the frontend polls
`/health`, and a preflight must succeed before any credentialed request. A
wildcard origin would silently break every such request, so it is asserted here
rather than discovered in production.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ALLOWED = "http://localhost:3000"


def _cors_client(origins: str, *, locked: bool = False) -> TestClient:
    settings = Settings(
        database_url="",
        nexus_access_key="a-very-long-test-passcode" if locked else "",
        storage_backend="local",
        cors_origins=origins,
        log_level="WARNING",
    )
    from app.config import get_settings

    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return TestClient(application)


def test_health_is_public_and_shaped_for_the_wake_banner(client) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    # The banner reads exactly these; a rename would blank the UI silently.
    assert body["status"] in {"ok", "degraded"}
    assert "auth" in body
    assert "database" in body
    assert "storage" in body
    assert "warnings" in body


def test_health_answers_while_passcode_is_locked(locked_client) -> None:
    """Cold-start polling must never be blocked by the passcode gate."""
    response = locked_client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["auth"]["mode"] == "passcode"


def test_preflight_allows_a_configured_origin(client) -> None:
    response = client.options(
        "/api/v1/items",
        headers={
            "Origin": ALLOWED,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-nexus-key",
        },
    )
    assert response.status_code in {200, 204}
    assert response.headers.get("access-control-allow-origin") == ALLOWED
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_preflight_does_not_echo_an_unlisted_origin(client) -> None:
    response = client.options(
        "/api/v1/items",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_wildcard_origin_is_dropped_not_echoed() -> None:
    """`*` plus credentials is rejected by browsers, so it must not reach Starlette."""
    client = _cors_client("*")
    response = client.options(
        "/api/v1/items",
        headers={"Origin": "https://anything.example", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_wildcard_origin_is_surfaced_as_a_warning() -> None:
    settings = Settings(
        database_url="",
        nexus_access_key="",
        storage_backend="local",
        cors_origins="http://localhost:3000,*",
        log_level="WARNING",
    )
    assert settings.cors_origin_list == ["http://localhost:3000"]
    assert settings.cors_wildcard_requested is True
    assert any("CORS_ORIGINS" in note for note in settings.warnings())


def test_no_wildcard_warning_for_an_explicit_list() -> None:
    settings = Settings(
        database_url="",
        nexus_access_key="",
        storage_backend="local",
        cors_origins="http://localhost:3000,https://nexus.example",
        log_level="WARNING",
    )
    assert settings.cors_wildcard_requested is False
    assert not any("CORS_ORIGINS" in note for note in settings.warnings())
