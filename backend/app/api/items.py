"""Item routes: library listing, inspector detail, edits, triage, links, notes."""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, Response, status

from ..auth import require_access
from ..models import (
    Item,
    ItemDetail,
    ItemLinkCreate,
    ItemLinkView,
    ItemUpdate,
    LibraryFilters,
    NoteContentUpdate,
    Page,
    ProgressUpdate,
    SourceFormat,
    TimeBudget,
    TriageStatus,
    TriageUpdate,
    clamp_limit,
    clamp_offset,
)
from ..services import items as items_service
from .deps import get_cursor, get_storage_dep

router = APIRouter(tags=["items"], dependencies=[Depends(require_access)])


@router.get(
    "/items",
    response_model=Page[Item],
    summary="List items (paginated, filtered)",
)
def list_items(
    workspace_id: UUID | None = Query(default=None),
    source_format: SourceFormat | None = Query(default=None),
    blueprint_id: UUID | None = Query(default=None),
    triage_status: TriageStatus | None = Query(default=None),
    collection_id: UUID | None = Query(default=None),
    tag: str | None = Query(default=None),
    time_budget: TimeBudget | None = Query(
        default=None, description="quick <5 min, medium 15-30 min, deep >30 min"
    ),
    q: str | None = Query(default=None, description="Title substring match"),
    sort: str = Query(default="recent"),
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Page[Item]:
    filters = LibraryFilters(
        workspace_id=workspace_id,
        source_format=source_format,
        blueprint_id=blueprint_id,
        triage_status=triage_status,
        collection_id=collection_id,
        tag=tag,
        time_budget=time_budget,
        q=q,
        sort=sort if sort in {"recent", "created", "title", "reading_time", "word_count"} else "recent",
        limit=clamp_limit(limit),
        offset=clamp_offset(offset),
    )
    return items_service.list_items(cur, filters)


@router.get(
    "/items/{item_id}",
    response_model=ItemDetail,
    summary="Get an item with segments, tags, collections and links",
)
def get_item(
    item_id: UUID,
    include_segments: bool = Query(default=True),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> ItemDetail:
    return items_service.get_detail(cur, item_id, include_segments=include_segments)


@router.patch("/items/{item_id}", response_model=Item, summary="Update item metadata")
def update_item(
    item_id: UUID, payload: ItemUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Item:
    return items_service.update_item(cur, item_id, payload)


@router.post("/items/{item_id}/triage", response_model=Item, summary="Set triage status")
def set_triage(
    item_id: UUID, payload: TriageUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Item:
    return items_service.set_triage(cur, item_id, payload)


@router.post(
    "/items/{item_id}/progress",
    response_model=Item,
    summary="Record reading progress (exact page/segment)",
)
def set_progress(
    item_id: UUID, payload: ProgressUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Item:
    return items_service.set_progress(cur, item_id, payload)


@router.put(
    "/items/{item_id}/content",
    response_model=ItemDetail,
    summary="Edit a note inline and re-index it",
)
def replace_content(
    item_id: UUID, payload: NoteContentUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> ItemDetail:
    return items_service.replace_note_content(cur, item_id, payload)


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete an item and its segments",
)
def delete_item(item_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return items_service.delete_item(cur, item_id)


# ------------------------------------------------------------------------ links
@router.post(
    "/items/{item_id}/links",
    response_model=ItemLinkView,
    status_code=status.HTTP_201_CREATED,
    summary="Create a typed link to another item",
)
def create_link(
    item_id: UUID, payload: ItemLinkCreate, cur: psycopg.Cursor = Depends(get_cursor)
) -> ItemLinkView:
    return items_service.create_link(cur, item_id, payload)


@router.delete("/items/{item_id}/links/{link_id}", summary="Delete a typed link")
def delete_link(
    item_id: UUID, link_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)
) -> dict:
    return items_service.delete_link(cur, item_id, link_id)


# ---------------------------------------------------------------------- segments
@router.get(
    "/items/{item_id}/segments/{segment_index}",
    summary="Fetch one segment (page/section) for the inspector",
)
def get_segment(
    item_id: UUID, segment_index: int, cur: psycopg.Cursor = Depends(get_cursor)
) -> dict:
    from ..repositories import items as items_repo

    items_service.require_item(cur, item_id)
    for segment in items_repo.list_segments(cur, item_id):
        if segment["segment_index"] == segment_index:
            return segment
    from ..errors import not_found

    raise not_found("segment", segment_index)


@router.get("/items/{item_id}/download", summary="Stream the original file")
def download_item(
    item_id: UUID,
    cur: psycopg.Cursor = Depends(get_cursor),
    storage=Depends(get_storage_dep),
) -> Response:
    """Bytes are proxied through the API so a private bucket stays private."""
    from ..errors import bad_request
    from ..storage import StorageError

    row = items_service.require_item(cur, item_id)
    if not row.get("source_uri"):
        raise bad_request("this item has no stored file", code="no_file")
    try:
        data = storage.get(row["source_uri"])
    except StorageError as exc:
        raise bad_request("the stored file is missing", code="file_missing", detail=str(exc))
    filename = (row.get("metadata") or {}).get("filename") or f"{row['title'][:60]}.bin"
    return Response(
        content=data,
        media_type=row.get("mime_type") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
