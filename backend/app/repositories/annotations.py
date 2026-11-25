"""Page-anchored reader annotations (notes and highlights).

Deliberately small: the reader only needs create, list, update and delete, and
every read is scoped to one item so the (item_id, segment_index) index covers it.
`quote_text` is stored verbatim and never re-resolved against current segment
content — a highlight marks what the reader saw at the time, not what a later
re-extraction happened to produce.
"""

from __future__ import annotations

from typing import Any, Mapping
from uuid import UUID

import psycopg

from .base import fetch_one

COLUMNS = (
    "id, item_id, segment_index, segment_label, quote_text, note_body, color, "
    "created_at, updated_at"
)


def create(cur: psycopg.Cursor, item_id: UUID, values: Mapping[str, Any]) -> dict[str, Any]:
    row = fetch_one(
        cur,
        f"insert into annotations (item_id, segment_index, segment_label, quote_text, "
        f"note_body, color) values (%(item_id)s, %(segment_index)s, %(segment_label)s, "
        f"%(quote_text)s, %(note_body)s, %(color)s) returning {COLUMNS}",
        {
            "item_id": item_id,
            "segment_index": values.get("segment_index"),
            "segment_label": values.get("segment_label"),
            "quote_text": values.get("quote_text"),
            "note_body": values.get("note_body") or "",
            "color": values.get("color") or "default",
        },
    )
    if row is None:  # pragma: no cover - insert with returning always yields a row
        raise RuntimeError("annotation insert returned no row")
    return row


def list_for_item(
    cur: psycopg.Cursor,
    item_id: UUID,
    *,
    segment_index: int | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Newest first. `segment_index` narrows to the reader's "this page" filter."""
    if segment_index is None:
        return list(
            cur.execute(
                f"select {COLUMNS} from annotations where item_id = %(item_id)s "
                "order by created_at desc limit %(limit)s",
                {"item_id": item_id, "limit": limit},
            ).fetchall()
        )
    return list(
        cur.execute(
            f"select {COLUMNS} from annotations where item_id = %(item_id)s "
            "and segment_index = %(segment_index)s order by created_at desc limit %(limit)s",
            {"item_id": item_id, "segment_index": segment_index, "limit": limit},
        ).fetchall()
    )


def get(cur: psycopg.Cursor, annotation_id: UUID) -> dict[str, Any] | None:
    return fetch_one(cur, f"select {COLUMNS} from annotations where id = %(id)s", {"id": annotation_id})


def update(
    cur: psycopg.Cursor, annotation_id: UUID, values: Mapping[str, Any]
) -> dict[str, Any] | None:
    """Only the fields the caller supplied are written; omitted ones are untouched."""
    allowed = ("segment_index", "segment_label", "quote_text", "note_body", "color")
    sets = [f"{column} = %({column})s" for column in allowed if column in values]
    if not sets:
        return get(cur, annotation_id)
    params: dict[str, Any] = {"id": annotation_id}
    for column in allowed:
        if column in values:
            params[column] = values[column]
    return fetch_one(
        cur,
        f"update annotations set {', '.join(sets)} where id = %(id)s returning {COLUMNS}",
        params,
    )


def delete(cur: psycopg.Cursor, annotation_id: UUID) -> bool:
    cur.execute("delete from annotations where id = %(id)s", {"id": annotation_id})
    return cur.rowcount > 0


def count_for_item(cur: psycopg.Cursor, item_id: UUID) -> int:
    row = fetch_one(
        cur,
        "select count(*) as n from annotations where item_id = %(item_id)s",
        {"item_id": item_id},
    )
    return int((row or {}).get("n") or 0)
