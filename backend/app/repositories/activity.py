"""Activity log plus the dashboard aggregation queries."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from . import items as items_repo
from .base import fetch_all, fetch_scalar, insert_returning

ACTIVITY_COLUMNS = "id, item_id, kind, message, metadata, created_at"


def log(
    cur: psycopg.Cursor,
    kind: str,
    message: str,
    *,
    item_id: UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict:
    return insert_returning(
        cur,
        "activity_logs",
        {
            "item_id": item_id,
            "kind": kind,
            "message": message[:500],
            "metadata": Jsonb(metadata or {}),
        },
        returning=ACTIVITY_COLUMNS,
    )


def list_recent(cur: psycopg.Cursor, limit: int = 20) -> list[dict]:
    return fetch_all(
        cur,
        f"select {ACTIVITY_COLUMNS} from activity_logs order by created_at desc limit %(limit)s",
        {"limit": max(1, min(limit, 200))},
    )


def dashboard(cur: psycopg.Cursor, *, workspace_id: UUID | None = None) -> dict[str, Any]:
    """One place for the numbers the Dashboard shows. Cheap aggregate queries."""
    params = {"workspace_id": workspace_id} if workspace_id else {}
    clause = " where workspace_id = %(workspace_id)s" if workspace_id else ""
    total_items = int(
        fetch_scalar(cur, f"select count(*) as n from items{clause}", params, default=0)
    )
    inbox = int(
        fetch_scalar(
            cur,
            "select count(*) as n from items where triage_status = 'inbox'"
            + (" and workspace_id = %(workspace_id)s" if workspace_id else ""),
            params,
            default=0,
        )
    )
    return {
        "totals": {
            "items": total_items,
            "inbox": inbox,
            "reading": int(
                fetch_scalar(
                    cur,
                    "select count(*) as n from items where triage_status = 'reading'"
                    + (" and workspace_id = %(workspace_id)s" if workspace_id else ""),
                    params,
                    default=0,
                )
            ),
            "workspaces": int(fetch_scalar(cur, "select count(*) as n from workspaces", default=0)),
            "tags": int(fetch_scalar(cur, "select count(*) as n from tags", default=0)),
            "collections": int(
                fetch_scalar(cur, "select count(*) as n from collections", default=0)
            ),
            "segments": int(
                fetch_scalar(cur, "select count(*) as n from item_segments", default=0)
            ),
        },
        "by_format": items_repo.count_by(cur, "source_format", workspace_id=workspace_id),
        "by_blueprint": items_repo.blueprint_counts(cur, workspace_id=workspace_id),
        "by_triage": items_repo.count_by(cur, "triage_status", workspace_id=workspace_id),
        "scanned_segments": items_repo.count_scanned_segments(cur),
        "failed_extractions": items_repo.count_failed_items(cur),
        "continue_reading": items_repo.continue_reading(cur, limit=5),
        "recently_added": items_repo.recently_added(cur, limit=8),
        "recent_activity": list_recent(cur, limit=10),
    }
