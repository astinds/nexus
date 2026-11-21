"""Applies numbered SQL migrations to PostgreSQL, idempotently.

Usage (from repo root):
    python scripts/apply_migrations.py --dry-run          # list what would run
    DATABASE_URL=postgresql://... python scripts/apply_migrations.py
    python scripts/apply_migrations.py --database-url ... --verify

Design notes:
  * Files run in filename order: supabase/migrations/NNN_name.sql.
  * Each migration runs inside one transaction; a failure rolls the whole file
    back and stops the run, so the schema never sits half-applied.
  * schema_migrations records version + SHA-256. A changed file that was already
    applied is refused (edit an applied migration only by adding a new one).
  * --verify only reads: it reports applied vs pending and exits non-zero when
    anything is pending.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    if not directory.is_dir():
        raise SystemExit(f"migration directory not found: {directory}")
    files = sorted(path for path in directory.glob("*.sql") if path.is_file())
    if not files:
        raise SystemExit(f"no .sql migrations in {directory}")
    return files


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def version_of(path: Path) -> str:
    return path.stem


def _connect(database_url: str):
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:  # pragma: no cover
        raise SystemExit("psycopg is not installed: pip install -r requirements-dev.txt")
    return psycopg.connect(
        database_url, row_factory=dict_row, autocommit=False, connect_timeout=15
    )


def applied_versions(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            "select to_regclass('public.schema_migrations') is not null as present"
        )
        if not (cur.fetchone() or {}).get("present"):
            return {}
        cur.execute("select version, checksum from schema_migrations")
        return {row["version"]: row["checksum"] for row in cur.fetchall()}


def apply(database_url: str, *, dry_run: bool = False, verify_only: bool = False) -> int:
    files = migration_files()

    if dry_run:
        print(f"{len(files)} migration file(s) found:")
        for path in files:
            print(f"  {version_of(path)}  sha256={checksum(path)[:12]}  ({path.name})")
        return 0

    conn = _connect(database_url)
    try:
        done = applied_versions(conn)
        pending = [path for path in files if version_of(path) not in done]

        for path in files:
            version = version_of(path)
            digest = checksum(path)
            if version in done and done[version] != digest:
                print(
                    f"REFUSED: {version} was already applied with a different checksum.\n"
                    "Add a new migration instead of editing an applied one.",
                    file=sys.stderr,
                )
                return 2

        if verify_only:
            print(f"applied: {len(done)}  pending: {len(pending)}")
            for path in pending:
                print(f"  pending {version_of(path)}")
            return 0 if not pending else 1

        if not pending:
            print(f"nothing to do: all {len(files)} migrations already applied")
            return 0

        for path in pending:
            version = version_of(path)
            sql = path.read_text(encoding="utf-8")
            print(f"applying {version} ...", end=" ", flush=True)
            try:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(sql)
                        cur.execute(
                            "insert into schema_migrations (version, checksum) values (%s, %s) "
                            "on conflict (version) do update set checksum = excluded.checksum",
                            (version, checksum(path)),
                        )
            except Exception as exc:
                print("FAILED")
                print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
                return 1
            print("ok")

        print(f"done: {len(pending)} migration(s) applied")
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply NEXUS SQL migrations")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="PostgreSQL connection string (default: $DATABASE_URL)",
    )
    parser.add_argument("--dry-run", action="store_true", help="List files without connecting")
    parser.add_argument("--verify", action="store_true", help="Report status, change nothing")
    args = parser.parse_args(argv)

    if not args.dry_run and not args.database_url:
        print("DATABASE_URL is not set (or pass --database-url)", file=sys.stderr)
        return 2
    return apply(args.database_url, dry_run=args.dry_run, verify_only=args.verify)


if __name__ == "__main__":
    raise SystemExit(main())
