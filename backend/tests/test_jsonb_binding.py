"""jsonb parameter adaptation in the repository primitives.

Live bug this pins: every ingest died with
`psycopg.ProgrammingError: cannot adapt type 'dict' using placeholder '%s'`
because `items.create` handed plain dicts for `custom_fields` and `metadata`
straight to psycopg, which has no default adapter for `dict`. `insert_returning`
now wraps them in `Jsonb`. These tests fail if that wrapping is ever removed.
"""

from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from app.repositories.base import as_parameter, insert_returning, update_returning


class RecordingCursor:
    """Minimal psycopg cursor stand-in: records SQL and bound parameters."""

    def __init__(self, row: dict | None = None) -> None:
        self.row = row if row is not None else {"id": "00000000-0000-0000-0000-000000000001"}
        self.sql: str = ""
        self.params: dict[str, Any] = {}

    def execute(self, sql: str, params: Any = None) -> "RecordingCursor":
        self.sql = sql
        self.params = dict(params or {})
        return self

    def fetchone(self) -> dict | None:
        return self.row


def test_as_parameter_wraps_dicts_only() -> None:
    wrapped = as_parameter({"a": 1})
    assert isinstance(wrapped, Jsonb)
    # Arrays must stay arrays: `tags.aliases` is a text[] column.
    array = ["a", "b"]
    assert as_parameter(array) is array
    assert as_parameter("text") == "text"
    assert as_parameter(None) is None


def test_as_parameter_leaves_existing_jsonb_alone() -> None:
    already = Jsonb({"a": 1})
    assert as_parameter(already) is already


def test_insert_returning_binds_jsonb_columns() -> None:
    cur = RecordingCursor()
    insert_returning(
        cur,
        "items",
        {"title": "Note", "custom_fields": {"topic": "x"}, "metadata": {"engine": "text"}},
    )
    assert "insert into items" in cur.sql
    assert cur.params["v0"] == "Note"
    assert isinstance(cur.params["v1"], Jsonb)
    assert isinstance(cur.params["v2"], Jsonb)


def test_insert_returning_leaves_arrays_bindable() -> None:
    cur = RecordingCursor()
    insert_returning(cur, "tags", {"name": "deep-work", "aliases": ["focus", "flow"]})
    assert cur.params["v1"] == ["focus", "flow"]
    assert not isinstance(cur.params["v1"], Jsonb)


def test_update_returning_binds_jsonb_columns() -> None:
    cur = RecordingCursor()
    update_returning(
        cur,
        "items",
        ident={"id": "00000000-0000-0000-0000-000000000001"},
        values={"custom_fields": {"stage": "reading"}},
    )
    assert isinstance(cur.params["s0"], Jsonb)
