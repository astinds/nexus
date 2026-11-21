"""Item and segment persistence."""

from __future__ import annotations

from typing import Any, Sequence
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from ..models import LibraryFilters
from .base import (
    Query,
    count_rows,
    execute,
    fetch_all,
    fetch_one,
    fetch_scalar,
    insert_returning,
    order_by,
    update_returning,
)

# Explicit column list: the Library list endpoint must not drag segment bodies
# or metadata blobs across the wire (Supabase Free egress and Render RAM).
LIST_COLUMNS = """
    i.id, i.workspace_id, i.blueprint_id, i.title, i.source_format, i.source_uri,
    i.snapshot_uri, i.mime_type, i.file_size, i.word_count, i.est_read_minutes,
    i.content_hash, i.processing_status, i.triage_status, i.reading_progress,
    i.error_message, i.summary, i.custom_fields, i.metadata, i.created_at, i.updated_at
"""

ITEM_COLUMNS = [column.strip() for column in LIST_COLUMNS.replace("\n", " ").split(",")]
ITEM_COLUMNS = [column[2:] if column.startswith("i.") else column for column in ITEM_COLUMNS]
UPDATABLE_COLUMNS = set(ITEM_COLUMNS) - {"id", "created_at"}


# ------------------------------------------------------------------------- items
def create(cur: psycopg.Cursor, values: dict[str, Any]) -> dict:
    return insert_returning(cur, "items", values)


def get(cur: psycopg.Cursor, item_id: UUID) -> dict | None:
    return fetch_one(
        cur, f"select {LIST_COLUMNS} from items i where i.id = %(id)s", {"id": item_id}
    )


def get_by_hash(cur: psycopg.Cursor, workspace_id: UUID, content_hash: str) -> dict | None:
    if not content_hash:
        return None
    return fetch_one(
        cur,
        f"select {LIST_COLUMNS} from items i "
        "where i.workspace_id = %(workspace_id)s and i.content_hash = %(hash)s",
        {"workspace_id": workspace_id, "hash": content_hash},
    )


def update(cur: psycopg.Cursor, item_id: UUID, values: dict[str, Any]) -> dict | None:
    clean = {
        key: value
        for key, value in values.items()
        if key in UPDATABLE_COLUMNS and value is not None
    }
    if not clean:
        return get(cur, item_id)
    row = update_returning(
        cur,
        "items",
        ident={"id": item_id},
        values=clean,
        returning=", ".join(ITEM_COLUMNS),
    )
    return row


def delete(cur: psycopg.Cursor, item_id: UUID) -> bool:
    return execute(cur, "delete from items where id = %(id)s", {"id": item_id}) > 0


def exists(cur: psycopg.Cursor, item_id: UUID) -> bool:
    return bool(
        fetch_scalar(cur, "select count(*) as n from items where id = %(id)s", {"id": item_id})
    )


def _library_query(filters: LibraryFilters) -> Query:
    query = Query()
    query.eq("i.workspace_id", filters.workspace_id, cast="uuid")
    if filters.source_format:
        query.eq("i.source_format", filters.source_format.value)
    query.eq("i.blueprint_id", filters.blueprint_id, cast="uuid")
    if filters.triage_status:
        query.eq("i.triage_status", filters.triage_status.value)
    query.ilike("i.title", filters.q)
    if filters.tag:
        query.raw(
            "exists (select 1 from item_tags it join tags t on t.id = it.tag_id "
            "where it.item_id = i.id and (lower(t.name) = lower(%(tag)s) "
            "or lower(%(tag)s) = any(select lower(a) from unnest(t.aliases) a)))",
            tag=filters.tag.strip(),
        )
    if filters.collection_id:
        query.raw(
            "exists (select 1 from item_collections ic where ic.item_id = i.id "
            "and ic.collection_id in (select id from nexus_collection_tree(%(collection_id)s::uuid)))",
            collection_id=str(filters.collection_id),
        )
    if filters.time_budget:
        budget = filters.time_budget.value
        if budget == "quick":
            query.raw("i.est_read_minutes < 5")
        elif budget == "medium":
            query.raw("i.est_read_minutes between 15 and 30")
        else:
            query.raw("i.est_read_minutes > 30")
    return query


def list_paged(cur: psycopg.Cursor, filters: LibraryFilters) -> tuple[list[dict], int]:
    query = _library_query(filters)
    total = count_rows(cur, "items i", query)
    sql = (
        f"select {LIST_COLUMNS} from items i{query.where()} "
        f"order by {order_by(filters.sort)} limit %(limit)s offset %(offset)s"
    )
    params = {**query.params, "limit": filters.limit, "offset": filters.offset}
    return fetch_all(cur, sql, params), total


def continue_reading(cur: psycopg.Cursor, limit: int = 5) -> list[dict]:
    return fetch_all(
        cur,
        f"select {LIST_COLUMNS} from items i "
        "where i.triage_status = 'reading' order by i.updated_at desc limit %(limit)s",
        {"limit": limit},
    )


def recently_added(cur: psycopg.Cursor, limit: int = 8) -> list[dict]:
    return fetch_all(
        cur,
        f"select {LIST_COLUMNS} from items i order by i.created_at desc limit %(limit)s",
        {"limit": limit},
    )


def count_by(cur: psycopg.Cursor, column: str, *, workspace_id: UUID | None = None) -> dict[str, int]:
    """Counts for the dashboard. `column` comes from a fixed whitelist below."""
    if column not in {"source_format", "triage_status", "processing_status", "blueprint_id"}:
        raise ValueError(f"unsupported grouping column: {column}")
    clause = " where workspace_id = %(workspace_id)s" if workspace_id else ""
    rows = fetch_all(
        cur,
        f"select coalesce({column}::text, 'unassigned') as key, count(*) as n from items{clause} "
        f"group by 1 order by 2 desc",
        {"workspace_id": workspace_id} if workspace_id else {},
    )
    return {str(row["key"]): int(row["n"]) for row in rows}


def blueprint_counts(cur: psycopg.Cursor, *, workspace_id: UUID | None = None) -> dict[str, int]:
    clause = "where i.workspace_id = %(workspace_id)s" if workspace_id else ""
    rows = fetch_all(
        cur,
        "select coalesce(b.name, 'Unassigned') as key, count(*) as n "
        f"from items i left join metadata_blueprints b on b.id = i.blueprint_id {clause} "
        "group by 1 order by 2 desc",
        {"workspace_id": workspace_id} if workspace_id else {},
    )
    return {str(row["key"]): int(row["n"]) for row in rows}


def count_scanned_segments(cur: psycopg.Cursor) -> int:
    return int(
        fetch_scalar(cur, "select count(*) as n from item_segments where is_scanned", default=0)
    )


def count_failed_items(cur: psycopg.Cursor) -> int:
    return int(
        fetch_scalar(
            cur, "select count(*) as n from items where processing_status in ('failed','partial')"
        )
    )


# ---------------------------------------------------------------------- segments
SEGMENT_COLUMNS = (
    "id, item_id, segment_index, segment_label, content, is_scanned, "
    "extraction_status, metadata, created_at"
)


def insert_segments(cur: psycopg.Cursor, item_id: UUID, segments: Sequence[dict[str, Any]]) -> int:
    if not segments:
        return 0
    sql = (
        "insert into item_segments "
        "(item_id, segment_index, segment_label, content, is_scanned, extraction_status, metadata) "
        "values (%(item_id)s, %(segment_index)s, %(segment_label)s, %(content)s, "
        "%(is_scanned)s, %(extraction_status)s, %(metadata)s) "
        "on conflict (item_id, segment_index) do update set "
        "segment_label = excluded.segment_label, content = excluded.content, "
        "is_scanned = excluded.is_scanned, extraction_status = excluded.extraction_status, "
        "metadata = excluded.metadata"
    )
    params = [
        {
            "item_id": item_id,
            "segment_index": segment["segment_index"],
            "segment_label": segment["segment_label"],
            "content": segment.get("content") or "",
            "is_scanned": bool(segment.get("is_scanned")),
            "extraction_status": segment.get("extraction_status") or "ok",
            "metadata": Jsonb(segment.get("metadata") or {}),
        }
        for segment in segments
    ]
    cur.executemany(sql, params)
    return len(segments)


def list_segments(
    cur: psycopg.Cursor, item_id: UUID, *, with_content: bool = True
) -> list[dict]:
    columns = SEGMENT_COLUMNS if with_content else (
        "id, item_id, segment_index, segment_label, is_scanned, extraction_status, metadata, created_at"
    )
    return fetch_all(
        cur,
        f"select {columns} from item_segments where item_id = %(item_id)s "
        "order by segment_index asc",
        {"item_id": item_id},
    )


def get_segment(cur: psycopg.Cursor, segment_id: UUID) -> dict | None:
    return fetch_one(
        cur,
        f"select {SEGMENT_COLUMNS} from item_segments where id = %(id)s",
        {"id": segment_id},
    )


def delete_segments(cur: psycopg.Cursor, item_id: UUID) -> int:
    return execute(cur, "delete from item_segments where item_id = %(item_id)s", {"item_id": item_id})


def integrity(cur: psycopg.Cursor, item_id: UUID) -> dict[str, Any]:
    """Honest extraction audit: counts plus the labels that need attention."""
    row = fetch_one(
        cur,
        "select count(*) as segments, "
        "count(*) filter (where extraction_status = 'ok') as extracted, "
        "count(*) filter (where is_scanned) as scanned, "
        "count(*) filter (where extraction_status = 'empty') as empty, "
        "count(*) filter (where extraction_status = 'failed') as failed "
        "from item_segments where item_id = %(item_id)s",
        {"item_id": item_id},
    ) or {}
    labels = fetch_one(
        cur,
        "select coalesce(array_agg(segment_label order by segment_index) "
        "filter (where is_scanned), '{}') as scanned, "
        "coalesce(array_agg(segment_label order by segment_index) "
        "filter (where extraction_status = 'failed'), '{}') as failed "
        "from item_segments where item_id = %(item_id)s",
        {"item_id": item_id},
    ) or {}
    segments = int(row.get("segments") or 0)
    failed = int(row.get("failed") or 0)
    scanned = int(row.get("scanned") or 0)
    return {
        "segments": segments,
        "pages": segments,
        "extracted": int(row.get("extracted") or 0),
        "scanned": scanned,
        "empty": int(row.get("empty") or 0),
        "failed": failed,
        "partial": failed > 0 or scanned > 0,
        "scanned_labels": list(labels.get("scanned") or []),
        "failed_labels": list(labels.get("failed") or []),
    }
