"""Collection persistence: hierarchical, PARA-aware, workspace-scoped."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..models import CollectionCreate, CollectionUpdate
from .base import execute, fetch_all, fetch_one, insert_returning, update_returning

COLLECTION_COLUMNS = (
    "id, workspace_id, name, description, para_type, parent_id, created_at"
)


def list_all(cur: psycopg.Cursor, *, workspace_id: UUID | None = None) -> list[dict]:
    clause = " where workspace_id = %(workspace_id)s" if workspace_id else ""
    return fetch_all(
        cur,
        f"select {COLLECTION_COLUMNS} from collections{clause} order by lower(name) asc",
        {"workspace_id": workspace_id} if workspace_id else {},
    )


def get(cur: psycopg.Cursor, collection_id: UUID) -> dict | None:
    return fetch_one(
        cur,
        f"select {COLLECTION_COLUMNS} from collections where id = %(id)s",
        {"id": collection_id},
    )


def create(cur: psycopg.Cursor, payload: CollectionCreate) -> dict:
    values = payload.model_dump()
    values["para_type"] = payload.para_type.value if payload.para_type else None
    return insert_returning(cur, "collections", values)


def update(cur: psycopg.Cursor, collection_id: UUID, payload: CollectionUpdate) -> dict | None:
    values = payload.model_dump(exclude_unset=True)
    if "para_type" in values and payload.para_type is not None:
        values["para_type"] = payload.para_type.value
    if not values:
        return get(cur, collection_id)
    return update_returning(
        cur, "collections", ident={"id": collection_id}, values=values,
        returning=COLLECTION_COLUMNS,
    )


def delete(cur: psycopg.Cursor, collection_id: UUID) -> bool:
    return execute(cur, "delete from collections where id = %(id)s", {"id": collection_id}) > 0


def descendant_ids(cur: psycopg.Cursor, collection_id: UUID) -> list[UUID]:
    """The collection plus every nested child (used by the Library filter)."""
    rows = fetch_all(
        cur,
        "with recursive tree as ("
        "  select id from collections where id = %(id)s "
        "  union all "
        "  select c.id from collections c join tree t on c.parent_id = t.id"
        ") select id from tree",
        {"id": collection_id},
    )
    return [row["id"] for row in rows]


def build_tree(rows: list[dict]) -> list[dict]:
    """Turn a flat list into a nested structure without recursion limits."""
    nodes: dict[UUID, dict] = {}
    for row in rows:
        nodes[row["id"]] = {**row, "children": []}
    roots: list[dict] = []
    for row in rows:
        node = nodes[row["id"]]
        parent_id = row.get("parent_id")
        parent = nodes.get(parent_id) if parent_id else None
        if parent is not None:
            parent["children"].append(node)
        else:
            roots.append(node)
    return roots


def for_item(cur: psycopg.Cursor, item_id: UUID) -> list[dict]:
    return fetch_all(
        cur,
        f"select c.{COLLECTION_COLUMNS.replace(', ', ', c.')} from collections c "
        "join item_collections ic on ic.collection_id = c.id "
        "where ic.item_id = %(item_id)s order by lower(c.name) asc",
        {"item_id": item_id},
    )


def attach(cur: psycopg.Cursor, item_id: UUID, collection_id: UUID) -> None:
    execute(
        cur,
        "insert into item_collections (item_id, collection_id) "
        "values (%(item_id)s, %(collection_id)s) on conflict do nothing",
        {"item_id": item_id, "collection_id": collection_id},
    )


def detach(cur: psycopg.Cursor, item_id: UUID, collection_id: UUID) -> bool:
    return (
        execute(
            cur,
            "delete from item_collections where item_id = %(item_id)s "
            "and collection_id = %(collection_id)s",
            {"item_id": item_id, "collection_id": collection_id},
        )
        > 0
    )


def replace_for_item(cur: psycopg.Cursor, item_id: UUID, collection_ids: list[UUID]) -> None:
    execute(cur, "delete from item_collections where item_id = %(item_id)s", {"item_id": item_id})
    for collection_id in collection_ids:
        attach(cur, item_id, collection_id)
