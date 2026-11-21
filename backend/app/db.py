"""PostgreSQL access layer.

Design notes (why it looks like this):
  * psycopg3 with a tiny connection pool. Render Free gives 512 MB RAM and a
    single user, so the pool stays at 1-4 connections.
  * Rows are dictionaries, so repositories never depend on column order.
  * `prepare_threshold=None` disables server-side prepared statements. Supabase's
    pooler (pgbouncer, transaction mode) breaks on them; the cost is negligible.
  * Failures are translated into `DatabaseUnavailable` so the API can answer with
    a clear 503 instead of a traceback.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger(__name__)


class DatabaseUnavailable(RuntimeError):
    """DATABASE_URL is missing, or the server cannot be reached."""


class Database:
    def __init__(
        self,
        url: str,
        *,
        min_size: int = 1,
        max_size: int = 4,
        connect_timeout: int = 10,
    ) -> None:
        self.url = (url or "").strip()
        self._min_size = min_size
        self._max_size = max_size
        self._connect_timeout = connect_timeout
        self._pool: Any = None
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.url)

    def _get_pool(self) -> Any:
        if not self.configured:
            raise DatabaseUnavailable("DATABASE_URL is not set")
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    from psycopg_pool import ConnectionPool

                    pool = ConnectionPool(
                        conninfo=self.url,
                        min_size=self._min_size,
                        max_size=self._max_size,
                        kwargs={
                            "row_factory": dict_row,
                            "connect_timeout": self._connect_timeout,
                            "prepare_threshold": None,
                        },
                        open=False,
                        name="nexus",
                    )
                    # open(wait=False) never blocks startup; the first request or
                    # the health probe waits for a real connection instead.
                    pool.open(wait=False)
                    self._pool = pool
        return self._pool

    @contextmanager
    def connection(self) -> Iterator[psycopg.Connection]:
        """Borrow a connection. Commits on clean exit, rolls back on error."""
        try:
            pool = self._get_pool()
            with pool.connection() as conn:
                yield conn
        except psycopg.OperationalError as exc:  # pragma: no cover - needs a dead DB
            raise DatabaseUnavailable(str(exc)) from exc

    @contextmanager
    def cursor(self) -> Iterator[psycopg.Cursor]:
        with self.connection() as conn:
            with conn.cursor() as cur:
                yield cur

    def health(self) -> dict[str, Any]:
        """Never raises: /api/v1/health must answer even with a dead database."""
        if not self.configured:
            return {
                "configured": False,
                "reachable": False,
                "detail": "DATABASE_URL is not set",
            }
        try:
            with self.cursor() as cur:
                cur.execute("select version() as server_version, current_database() as db")
                row = cur.fetchone() or {}
                migrations: int | None = None
                try:
                    cur.execute("select count(*) as n from schema_migrations")
                    migrations = int((cur.fetchone() or {}).get("n", 0))
                except Exception:
                    migrations = None
                return {
                    "configured": True,
                    "reachable": True,
                    "database": row.get("db"),
                    "server_version": (row.get("server_version") or "").split(",")[0],
                    "migrations_applied": migrations,
                }
        except Exception as exc:
            return {
                "configured": True,
                "reachable": False,
                "detail": f"{type(exc).__name__}: {exc}",
            }

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
            self._pool = None
