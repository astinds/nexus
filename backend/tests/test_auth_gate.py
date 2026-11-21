"""The passcode gate: open dev mode vs locked mode, header and cookie paths."""

from __future__ import annotations

from app.auth import SESSION_COOKIE, session_token


def test_health_is_always_public_and_reports_mode(client) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["auth"]["mode"] == "dev_open"
    assert body["auth"]["dev_open_access"] is True
    assert any("NEXUS_ACCESS_KEY" in warning for warning in body["warnings"])


def test_locked_api_requires_key(locked_client) -> None:
    assert locked_client.get("/api/v1/meta").status_code == 200  # meta stays public
    response = locked_client.get("/api/v1/tags")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_locked_api_accepts_header_key(locked_client) -> None:
    response = locked_client.get(
        "/api/v1/auth/session", headers={"X-Nexus-Key": "a-very-long-test-passcode"}
    )
    assert response.status_code == 200
    assert response.json()["authenticated"] is True


def test_wrong_key_is_rejected(locked_client) -> None:
    response = locked_client.post(
        "/api/v1/auth/session", headers={"X-Nexus-Key": "wrong-passcode"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_key"


def test_unlock_sets_httponly_cookie(locked_client) -> None:
    response = locked_client.post(
        "/api/v1/auth/session?key=a-very-long-test-passcode"
    )
    assert response.status_code == 200
    cookie_header = response.headers.get("set-cookie", "")
    assert SESSION_COOKIE in cookie_header
    assert "HttpOnly" in cookie_header
    assert "a-very-long-test-passcode" not in cookie_header


def test_hidden_state_reports_locked_without_error(client, locked_client) -> None:
    response = locked_client.get("/api/v1/auth/session")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "mode": "locked"}


def test_deleting_the_session_emits_an_expiring_cookie(locked_client) -> None:
    token = session_token("a-very-long-test-passcode")
    locked_client.cookies.set(SESSION_COOKIE, token)
    response = locked_client.delete("/api/v1/auth/session")
    assert response.status_code == 200
    header = response.headers.get("set-cookie", "")
    assert "Max-Age=0" in header
    assert "1970" in header  # explicit epoch, unambiguous for every client
    assert token not in header


def test_empty_or_forged_cookie_does_not_authenticate(locked_client) -> None:
    locked_client.cookies.set(SESSION_COOKIE, "")
    assert locked_client.get("/api/v1/auth/session").json()["authenticated"] is False
    locked_client.cookies.set(SESSION_COOKIE, "forged-token")
    assert locked_client.get("/api/v1/auth/session").json()["authenticated"] is False


def test_session_token_never_contains_the_passcode() -> None:
    token = session_token("a-very-long-test-passcode")
    assert "a-very-long-test-passcode" not in token
    assert len(token) == 64


def test_dev_mode_allows_data_routes(client) -> None:
    """No database configured: the route is reachable and fails on the DB, not auth."""
    response = client.get("/api/v1/tags")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
