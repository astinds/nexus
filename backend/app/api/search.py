"""Search and export routes."""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response

from ..auth import require_access
from ..models import (
    ExportFormat,
    SearchResponse,
    SourceFormat,
    TriageStatus,
    clamp_limit,
    clamp_offset,
)
from ..services import export as export_service
from ..services import items as items_service
from ..services import search as search_service
from ..repositories import items as items_repo
from ..repositories import tags as tags_repo
from ..repositories import collections as collections_repo
from ..repositories import activity
from .deps import get_cursor

router = APIRouter(tags=["search", "export"], dependencies=[Depends(require_access)])


@router.get("/search", response_model=SearchResponse, summary="Full-text search across segments")
def search(
    q: str = Query(default="", description="Free text; websearch syntax (AND, OR, \"phrase\") works"),
    workspace_id: UUID | None = Query(default=None),
    source_format: SourceFormat | None = Query(default=None),
    blueprint_id: UUID | None = Query(default=None),
    triage_status: TriageStatus | None = Query(default=None),
    collection_id: UUID | None = Query(default=None),
    tag: str | None = Query(default=None),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> SearchResponse:
    return search_service.search(
        cur,
        q=q,
        workspace_id=workspace_id,
        source_format=source_format,
        blueprint_id=blueprint_id,
        triage_status=triage_status,
        collection_id=collection_id,
        tag=tag,
        limit=clamp_limit(limit),
        offset=clamp_offset(offset),
    )


def _author_headers(item: dict, filename: str, media_type: str) -> dict[str, str]:
    ascii_name = "".join(char if char.isascii() and (char.isalnum() or char in " ._-") else "_" for char in filename)
    return {
        "Content-Disposition": f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{filename}',
        "Content-Type": media_type,
    }


@router.get(
    "/items/{item_id}/export/{fmt}",
    summary="Export one item (markdown | json | bibtex | apa | mla)",
)
def export_item(
    item_id: UUID,
    fmt: ExportFormat,
    download: bool = Query(default=True, description="Attachment vs inline text"),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Response:
    row = items_service.require_item(cur, item_id)
    segments = items_repo.list_segments(cur, item_id)
    item_tags = [tag["name"] for tag in tags_repo.for_item(cur, item_id)]
    item_collections = [entry["name"] for entry in collections_repo.for_item(cur, item_id)]

    body, media_type, filename = export_service.render(
        fmt, row, segments, tags=item_tags, collections=item_collections
    )
    activity.log(cur, "item.exported", f"Exported as {fmt.value}", item_id=item_id)
    headers = _author_headers(row, filename, media_type)
    if not download:
        headers["Content-Disposition"] = "inline"
    return Response(content=body, media_type=media_type, headers=headers)


@router.get("/export/library", summary="Full library backup as a ZIP")
def export_library(
    workspace_id: UUID | None = Query(default=None),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Response:
    from ..models import LibraryFilters

    filters = LibraryFilters(workspace_id=workspace_id, limit=200, offset=0)
    rows, total = items_repo.list_paged(cur, filters)

    # Page through the library in bounded batches: a 5 000-item library must not
    # need 5 000 segment bodies in RAM at once.
    all_rows: list[dict] = list(rows)
    while len(all_rows) < total:
        batch_filters = LibraryFilters(
            workspace_id=workspace_id, limit=200, offset=len(all_rows)
        )
        batch, _ = items_repo.list_paged(cur, batch_filters)
        if not batch:
            break
        all_rows.extend(batch)

    segments_by_item: dict[str, list[dict]] = {}
    tags_by_item: dict[str, list[str]] = {}
    collections_by_item: dict[str, list[str]] = {}
    for row in all_rows:
        key = str(row["id"])
        segments_by_item[key] = items_repo.list_segments(cur, row["id"])
        tags_by_item[key] = [tag["name"] for tag in tags_repo.for_item(cur, row["id"])]
        collections_by_item[key] = [
            entry["name"] for entry in collections_repo.for_item(cur, row["id"])
        ]

    payload = export_service.build_library_zip(
        all_rows,
        segments_by_item,
        tags_by_item=tags_by_item,
        collections_by_item=collections_by_item,
        manifest={"workspace_id": str(workspace_id) if workspace_id else None, "items": len(all_rows)},
    )
    activity.log(cur, "library.exported", f"Library backup: {len(all_rows)} items")
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="nexus-library.zip"',
        },
    )
