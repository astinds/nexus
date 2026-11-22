"""Item lifecycle: detail assembly, edits, triage, reading progress, links."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import psycopg

from ..errors import bad_request, not_found
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
    Segment,
    SegmentIntegrity,
    SourceFormat,
    Tag,
    TriageUpdate,
)
from ..repositories import activity, blueprints, collections, items, relations, tags
from ..text import count_words, read_minutes


def require_item(cur: psycopg.Cursor, item_id: UUID) -> dict:
    row = items.get(cur, item_id)
    if row is None:
        raise not_found("item", item_id)
    return row


def list_items(cur: psycopg.Cursor, filters: LibraryFilters) -> Page[Item]:
    rows, total = items.list_paged(cur, filters)
    return Page[Item](
        items=[Item(**row) for row in rows],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )


def get_detail(cur: psycopg.Cursor, item_id: UUID, *, include_segments: bool = True) -> ItemDetail:
    row = require_item(cur, item_id)
    item_tags = [Tag(**tag) for tag in tags.for_item(cur, item_id)]
    item_collections = collections.for_item(cur, item_id)
    segments = (
        [Segment(**segment) for segment in items.list_segments(cur, item_id)]
        if include_segments
        else None
    )
    links = [ItemLinkView(**link) for link in relations.list_for_item(cur, item_id)]
    audit = items.integrity(cur, item_id)

    blueprint_fields: list[dict[str, Any]] = []
    if row.get("blueprint_id"):
        blueprint = blueprints.get(cur, row["blueprint_id"])
        if blueprint:
            blueprint_fields = list(
                (blueprint.get("fields_schema") or {}).get("fields") or []
            )

    return ItemDetail(
        **row,
        tags=item_tags,
        collections=[_collection_model(entry) for entry in item_collections],
        segments=segments,
        links=links,
        integrity=SegmentIntegrity(**audit),
        blueprint_fields=blueprint_fields,
    )


def _collection_model(row: dict):
    from ..models import Collection

    return Collection(**row)


def update_item(cur: psycopg.Cursor, item_id: UUID, payload: ItemUpdate) -> Item:
    require_item(cur, item_id)
    values = payload.model_dump(exclude_unset=True)
    # Membership lists live in join tables, not on the items row.
    tag_names = values.pop("tags", None)
    collection_ids = values.pop("collection_ids", None)
    if "triage_status" in values and payload.triage_status is not None:
        values["triage_status"] = payload.triage_status.value
    updated = items.update(cur, item_id, values)
    if updated is None:  # pragma: no cover - row vanished mid-request
        raise not_found("item", item_id)
    if tag_names is not None:
        tags.replace_for_item(cur, item_id, list(tag_names))
    if collection_ids is not None:
        collections.replace_for_item(
            cur, item_id, [UUID(str(entry)) for entry in collection_ids]
        )
    activity.log(
        cur, "item.updated", f"Updated item: {updated['title'][:120]}",
        item_id=item_id,
        metadata={
            "fields": sorted(values)
            + (["tags"] if tag_names is not None else [])
            + (["collections"] if collection_ids is not None else [])
        },
    )
    return Item(**updated)


def set_triage(cur: psycopg.Cursor, item_id: UUID, payload: TriageUpdate) -> Item:
    require_item(cur, item_id)
    updated = items.update(cur, item_id, {"triage_status": payload.triage_status.value})
    assert updated is not None
    activity.log(
        cur, "item.triage", f"Triage -> {payload.triage_status.value}",
        item_id=item_id, metadata={"triage_status": payload.triage_status.value},
    )
    return Item(**updated)


def merge_progress(row: dict, payload: ProgressUpdate) -> dict:
    """Overlay a progress update onto stored progress.

    Pure so it can be tested without a database: every value is written when
    supplied, `updated_at` is a real ISO-8601 instant (not the literal "now").
    """
    progress = dict(row.get("reading_progress") or {})
    if payload.segment_index is not None:
        progress["segment_index"] = payload.segment_index
    if payload.segment_label is not None:
        progress["segment_label"] = payload.segment_label
    if payload.percent is not None:
        progress["percent"] = round(float(payload.percent), 2)
    if payload.location is not None:
        progress["location"] = payload.location
    progress["updated_at"] = datetime.now(timezone.utc).isoformat()
    return progress


def set_progress(cur: psycopg.Cursor, item_id: UUID, payload: ProgressUpdate) -> Item:
    row = require_item(cur, item_id)
    progress = merge_progress(row, payload)
    values: dict[str, Any] = {"reading_progress": progress}
    # Opening an item to read it is a triage signal, but never override a
    # deliberate put-down: reader -> reading only.
    if row.get("triage_status") in {"inbox", "processed", "evergreen", "cold_archive"}:
        if payload.segment_index is not None or payload.percent:
            values["triage_status"] = "reading"
    updated = items.update(cur, item_id, values)
    assert updated is not None
    return Item(**updated)


def replace_note_content(
    cur: psycopg.Cursor, item_id: UUID, payload: NoteContentUpdate
) -> ItemDetail:
    """Inline Markdown edit: rewrite segments and re-index in one transaction."""
    from ..extractors import resolve

    row = require_item(cur, item_id)
    if row["source_format"] not in {SourceFormat.note.value, SourceFormat.markdown.value}:
        raise bad_request(
            "only notes and Markdown items can be edited inline",
            code="not_editable",
        )
    extractor = resolve(source_format=SourceFormat.note)
    extraction = extractor.extract(text=payload.content)
    items.delete_segments(cur, item_id)
    created = items.insert_segments(
        cur, item_id, [segment.as_row() for segment in extraction.segments]
    )
    word_count = count_words(payload.content)
    updated = items.update(
        cur,
        item_id,
        {
            "word_count": word_count,
            "est_read_minutes": read_minutes(word_count),
            "processing_status": extraction.status.value,
            "file_size": len(payload.content.encode("utf-8")),
            "content_hash": __import__("hashlib").sha256(
                payload.content.encode("utf-8")
            ).hexdigest(),
            "error_message": "; ".join(extraction.warnings)[:2000] or None,
        },
    )
    assert updated is not None
    activity.log(
        cur, "item.reindexed", f"Re-indexed note ({created} segments)",
        item_id=item_id, metadata={"segments": created},
    )
    return get_detail(cur, item_id)


def delete_item(cur: psycopg.Cursor, item_id: UUID) -> dict[str, Any]:
    row = require_item(cur, item_id)
    deleted = items.delete(cur, item_id)
    if deleted:
        activity.log(
            cur, "item.deleted", f"Deleted item: {row['title'][:120]}",
            metadata={"item_id": str(item_id), "source_uri": row.get("source_uri")},
        )
    return {"deleted": deleted, "item_id": str(item_id), "source_uri": row.get("source_uri")}


# ------------------------------------------------------------------------ links
def create_link(cur: psycopg.Cursor, item_id: UUID, payload: ItemLinkCreate) -> ItemLinkView:
    require_item(cur, item_id)
    if payload.target_item_id == item_id:
        raise bad_request("an item cannot link to itself", code="self_link")
    require_item(cur, payload.target_item_id)
    if relations.get_type(cur, payload.relation_type_id) is None:
        raise not_found("relation type", payload.relation_type_id)
    if payload.source_segment_id is not None:
        segment = items.get_segment(cur, payload.source_segment_id)
        if segment is None or segment["item_id"] != item_id:
            raise bad_request(
                "source_segment_id must belong to this item", code="bad_segment"
            )
    link = relations.create_link(
        cur,
        source_item_id=item_id,
        target_item_id=payload.target_item_id,
        relation_type_id=payload.relation_type_id,
        source_segment_id=payload.source_segment_id,
        note=payload.note,
        item_id_for_view=item_id,
    )
    if link is None:
        raise bad_request(
            "this link already exists", code="duplicate_link"
        )
    activity.log(
        cur, "link.created", f"Linked to another item ({link.get('relation_name')})",
        item_id=item_id, metadata={"target": str(payload.target_item_id)},
    )
    return ItemLinkView(**link)


def delete_link(cur: psycopg.Cursor, item_id: UUID, link_id: UUID) -> dict[str, Any]:
    require_item(cur, item_id)
    deleted = relations.delete_link(cur, link_id)
    if not deleted:
        raise not_found("link", link_id)
    activity.log(cur, "link.deleted", "Removed a link", item_id=item_id)
    return {"deleted": True, "link_id": str(link_id)}
