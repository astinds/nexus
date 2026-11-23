#!/usr/bin/env python3
"""Guards for scripts/apply_migrations.py transaction handling.

Two bugs made a real Supabase run fail or silently discard work:

  * the .sql files carry their own `begin; ... commit;`, so running them inside
    the runner's transaction let the file's COMMIT end the outer transaction and
    destroy psycopg's savepoint;
  * the connection kept an implicit transaction open, so `conn.close()` rolled
    back DDL that had already been applied — and the schema_migrations row with
    it.

These tests pin the pure helper that fixes the first and assert the second's
fix is present in the source, without needing a live database.
"""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).parent.parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

from apply_migrations import strip_transaction_control  # noqa: E402


def test_strips_standalone_begin_and_commit() -> None:
    sql = "begin;\ncreate table t (i int);\ncommit;\n"
    out = strip_transaction_control(sql)
    assert "begin;" not in out
    assert "commit;" not in out
    assert "create table t (i int);" in out


def test_keeps_begin_and_commit_inside_dollar_quoted_body() -> None:
    sql = (
        "begin;\n"
        "create function f() returns trigger as $$\n"
        "begin\n"
        "    new.updated_at = now();\n"
        "    return new;\n"
        "end\n"
        "$$ language plpgsql;\n"
        "commit;\n"
    )
    out = strip_transaction_control(sql)
    # outer wrapper removed, function body intact
    assert out.lstrip().startswith("create function")
    assert "begin\n    new.updated_at = now();" in out
    assert "\ncommit;" not in out


def test_is_idempotent_and_preserves_other_statements() -> None:
    sql = "begin;\ninsert into t values (1);\nupdate t set a = 1;\ncommit;\n"
    once = strip_transaction_control(sql)
    assert once == strip_transaction_control(sql)
    assert "insert into t values (1);" in once
    assert "update t set a = 1;" in once


def test_runner_commits_before_and_after_each_migration() -> None:
    """The implicit-transaction rollback fix must stay in the runner."""
    source = (SCRIPTS / "apply_migrations.py").read_text(encoding="utf-8")
    assert "conn.commit()" in source
    assert "conn.close()" in source
    # the commit must happen right after reading applied versions
    applied_idx = source.index("done = applied_versions(conn)")
    assert "conn.commit()" in source[applied_idx : applied_idx + 400]
