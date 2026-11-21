"""Static validation of the SQL migrations.

There is no PostgreSQL server in this environment (see docs/PROJECT_STATE.md),
so the migrations are validated by parsing every statement and asserting the
schema objects the backend depends on. This catches syntax errors, typos in
column lists and accidental removals of required structures. It does NOT prove
runtime behaviour such as generated columns or GIN index usage; run
`python scripts/apply_migrations.py` against DATABASE_URL for that.
"""

from __future__ import annotations

from pathlib import Path

import sqlglot

MIGRATIONS = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"


def migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, "no migrations found"
    return "\n".join(path.read_text(encoding="utf-8") for path in files)


def statements() -> list[str]:
    """Split on top-level semicolons, ignoring comments and $$ ... $$ bodies."""
    text = migration_sql()
    # Strip line comments first so a ';' inside prose cannot split a statement.
    without_comments = "\n".join(
        line.split("--", 1)[0] for line in text.splitlines()
    )
    parts: list[str] = []
    buffer: list[str] = []
    in_dollar = False
    index = 0
    while index < len(without_comments):
        if without_comments.startswith("$$", index):
            in_dollar = not in_dollar
            buffer.append("$$")
            index += 2
            continue
        char = without_comments[index]
        if char == ";" and not in_dollar:
            parts.append("".join(buffer).strip())
            buffer = []
        else:
            buffer.append(char)
        index += 1
    tail = "".join(buffer).strip()
    if tail:
        parts.append(tail)
    return [part for part in parts if part]


def test_every_statement_parses_as_postgres() -> None:
    failures: list[str] = []
    for statement in statements():
        try:
            sqlglot.parse_one(statement, dialect="postgres")
        except Exception as exc:  # pragma: no cover - only on a broken migration
            failures.append(f"{statement.splitlines()[0][:80]} -> {exc}")
    assert not failures, "unparsable statements:\n" + "\n".join(failures)


def test_required_tables_exist() -> None:
    sql = migration_sql().lower()
    for table in (
        "workspaces",
        "metadata_blueprints",
        "collections",
        "tags",
        "item_collections",
        "item_tags",
        "items",
        "item_segments",
        "relation_types",
        "item_links",
        "saved_views",
        "prompt_templates",
        "user_preferences",
        "activity_logs",
        "schema_migrations",
    ):
        assert f"create table if not exists {table}" in sql, f"missing table {table}"


def test_items_columns_match_the_contract() -> None:
    sql = migration_sql().lower()
    items_block = sql.split("create table if not exists items", 1)[1].split(");", 1)[0]
    for column in (
        "workspace_id",
        "blueprint_id",
        "title",
        "source_format",
        "source_uri",
        "snapshot_uri",
        "mime_type",
        "file_size",
        "word_count",
        "est_read_minutes",
        "content_hash",
        "processing_status",
        "triage_status",
        "reading_progress",
        "error_message",
        "summary",
        "custom_fields",
        "metadata",
        "created_at",
        "updated_at",
    ):
        assert column in items_block, f"items missing column {column}"


def test_segments_hold_search_vector_and_scanned_flag() -> None:
    sql = migration_sql().lower()
    block = sql.split("create table if not exists item_segments", 1)[1].split(");", 1)[0]
    assert "search_vector" in block
    assert "tsvector" in block
    assert "is_scanned" in block
    assert "segment_label" in block
    assert "extraction_status" in block
    assert "unique (item_id, segment_index)" in block
    assert "using gin (search_vector)" in sql


def test_status_domains_are_enforced_by_check_constraints() -> None:
    sql = migration_sql().lower()
    assert "'inbox','reading','processed','evergreen','cold_archive'" in sql
    assert "'pending','processing','ready','partial','needs_enrichment','failed'" in sql
    assert "'project', 'area', 'resource', 'archive'" in sql


def test_seeded_relation_types_are_present() -> None:
    sql = migration_sql().lower()
    for name in (
        "relates_to",
        "supports",
        "contradicts",
        "extends",
        "cites",
        "example_of",
        "derived_from",
    ):
        assert name in sql, f"missing seeded relation type {name}"


def test_content_hash_uniqueness_is_per_workspace() -> None:
    sql = migration_sql().lower()
    assert "items_workspace_hash_key" in sql
    assert "on items (workspace_id, content_hash)" in sql


def test_migrations_are_numbered_and_ordered() -> None:
    names = [path.name for path in sorted(MIGRATIONS.glob("*.sql"))]
    assert names[0].startswith("001_")
    for name in names:
        prefix = name.split("_", 1)[0]
        assert prefix.isdigit(), f"{name} is not numbered"
    assert names == sorted(names)


def test_collection_tree_function_is_created() -> None:
    sql = migration_sql().lower()
    assert "nexus_collection_tree" in sql
    assert "create or replace function nexus_collection_tree" in sql


def test_migrations_are_idempotent() -> None:
    """Every CREATE/INSERT must tolerate a re-run."""
    sql = migration_sql().lower()
    create_table_statements = [
        line for line in sql.splitlines() if line.strip().startswith("create table")
    ]
    for line in create_table_statements:
        assert "if not exists" in line, f"not idempotent: {line.strip()}"
    insert_statements = [line for line in sql.splitlines() if line.strip().startswith("insert into")]
    assert insert_statements, "expected seed inserts"
    assert "on conflict" in sql


def test_no_secrets_or_placeholders_in_migrations() -> None:
    sql = migration_sql()
    for forbidden in ("CHANGE_ME", "password", "sk-", "service_role"):
        assert forbidden not in sql
