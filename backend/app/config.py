"""Configuration for NEXUS.

Every knob comes from the environment (or a local .env file); nothing is
hardcoded and no secret ever has a usable default. See ../.env.example.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_PREFIX = "/api/v1"

# A passcode shorter than this is treated as misconfiguration, not security.
MIN_ACCESS_KEY_LENGTH = 12


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- database ---------------------------------------------------------
    database_url: str = ""

    # --- auth -------------------------------------------------------------
    nexus_access_key: str = ""
    cookie_secure: bool = False

    # --- storage ----------------------------------------------------------
    storage_backend: str = "local"
    local_storage_dir: str = ".nexus-storage"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_bucket: str = "nexus-files"

    # --- limits / http ----------------------------------------------------
    max_upload_mb: int = 25
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    web_fetch_timeout_seconds: float = 20.0
    log_level: str = "INFO"

    @field_validator("storage_backend")
    @classmethod
    def _known_backend(cls, value: str) -> str:
        allowed = {"local", "supabase"}
        normalised = (value or "local").strip().lower()
        if normalised not in allowed:
            raise ValueError(f"storage_backend must be one of {sorted(allowed)}")
        return normalised

    @property
    def dev_open_access(self) -> bool:
        """True when no passcode is configured: open local development."""
        return not self.nexus_access_key.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        """Allowed origins, with bare `*` removed.

        `allow_credentials=True` is required for the session cookie, and browsers
        reject a wildcard ACAO on credentialed requests. Starlette would echo `*`
        and every preflight would fail at runtime, so a wildcard is dropped here
        and reported by `warnings()` instead of breaking silently.
        """
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip() and origin.strip() != "*"
        ]

    @property
    def cors_wildcard_requested(self) -> bool:
        return any(origin.strip() == "*" for origin in self.cors_origins.split(","))

    @property
    def max_upload_bytes(self) -> int:
        return max(1, self.max_upload_mb) * 1024 * 1024

    @property
    def storage_root(self) -> Path:
        return Path(self.local_storage_dir).expanduser().resolve()

    def warnings(self) -> list[str]:
        """Misconfigurations worth surfacing in /api/v1/health and on startup."""
        notes: list[str] = []
        if self.dev_open_access:
            notes.append(
                "NEXUS_ACCESS_KEY is not set: the API is open to anyone who can reach it. "
                "Set a long random value before exposing this deployment."
            )
        elif len(self.nexus_access_key.strip()) < MIN_ACCESS_KEY_LENGTH:
            notes.append(
                f"NEXUS_ACCESS_KEY is shorter than {MIN_ACCESS_KEY_LENGTH} characters."
            )
        if not self.database_url:
            notes.append("DATABASE_URL is not set: no database features will work.")
        if self.storage_backend == "supabase" and not (
            self.supabase_url and self.supabase_service_key
        ):
            notes.append(
                "storage_backend=supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY."
            )
        if self.cookie_secure is False:
            notes.append(
                "COOKIE_SECURE=false: fine locally, set true when serving over HTTPS."
            )
        if self.cors_wildcard_requested:
            notes.append(
                "CORS_ORIGINS contains '*', which is ignored: credentialed CORS "
                "cannot use a wildcard. List the exact frontend origins instead."
            )
        return notes


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached process-wide settings. Tests clear this cache when they patch env."""
    return Settings()
