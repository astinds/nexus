"""Annotation routes: list, create, edit and delete reader notes.

Mounted under the item so every query is naturally scoped: an annotation can only
be reached through the item that owns it, and the delete path refuses to remove
one that belongs to a different item (404 rather than a silent cross-item write).
"""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, status

from ..auth import require_access
from ..errors import not_found
from ..models.annotations import Annotation, AnnotationCreate, AnnotationUpdate
from ..repositories import annotations as repo
from ..repositories import items as items_repo
from .deps import get_cursor

router = APIRouter(tags=["annotations"], dependencies=[Depends(require_access)])


def _require_item(cur: psycopg.Cursor, item_id: UUID) -> None:
    if items_repo.get(cur, item_id) is None:
        raise not_found(f"item {item_id} not found")


def _owned(cur: psycopg.Cursor, item_id: UUID, annotation_id: UUID) -> dict:
    row = repo.get(cur, annotation_id)
    if row is None or row["item_id"] != item_id:
        raise not_found(f"annotation {annotation_id} not found")
    return row


@router.get(
    "/items/{item_id}/annotations",
    response_model=list[Annotation],
    summary="List notes and highlights for an item",
)
def list_annotations(
    item_id: UUID,
    segment: int | None = Query(default=None, ge=1, description="Only this page"),
    limit: int = Query(default=200, ge=1, le=500),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> list[Annotation]:
    _require_item(cur, item_id)
    return [Annotation(**row) for row in repo.list_for_item(cur, item_id, segment_index=segment, limit=limit)]


@router.post(
    "/items/{item_id}/annotations",
    response_model=Annotation,
    status_code=status.HTTP_201_CREATED,
    summary="Add a note or highlight",
)
def create_annotation(
    item_id: UUID,
    payload: AnnotationCreate,
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Annotation:
    _require_item(cur, item_id)
    row = repo.create(cur, item_id, payload.model_dump())
    return Annotation(**row)


@router.patch(
    "/items/{item_id}/annotations/{annotation_id}",
    response_model=Annotation,
    summary="Edit a note",
)
def update_annotation(
    item_id: UUID,
    annotation_id: UUID,
    payload: AnnotationUpdate,
    cur: psycopg.Cursor = Depends(get_cursor),
) -> Annotation:
    _owned(cur, item_id, annotation_id)
    row = repo.update(cur, annotation_id, payload.model_dump(exclude_unset=True))
    if row is None:
        raise not_found(f"annotation {annotation_id} not found")
    return Annotation(**row)


@router.delete(
    "/items/{item_id}/annotations/{annotation_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a note",
)
def delete_annotation(
    item_id: UUID,
    annotation_id: UUID,
    cur: psycopg.Cursor = Depends(get_cursor),
) -> dict:
    _owned(cur, item_id, annotation_id)
    return {"deleted": repo.delete(cur, annotation_id)}
