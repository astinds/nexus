"""Controlled vocabulary and typed intellectual links."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..errors import conflict
from ..models import RelationTypeCreate
from .base import execute, fetch_all, fetch_one, insert_returning

RELATION_COLUMNS = "id, name, description, is_seeded, created_at"

LINK_SELECT = """
select l.id, l.source_item_id, l.target_item_id, l.relation_type_id,
       rt.name as relation_name, l.source_segment_id, l.note, l.created_at,
       case when l.source_item_id = %(item_id)s then 'outgoing' else 'incoming' end as direction,
       case when l.source_item_id = %(item_id)s then l.target_item_id else l.source_item_id end
           as other_item_id,
       other.title as other_title, other.source_format as other_format
from item_links l
join relation_types rt on rt.id = l.relation_type_id
join items other on other.id = case
        when l.source_item_id = %(item_id)s then l.target_item_id else l.source_item_id end
where l.source_item_id = %(item_id)s or l.target_item_id = %(item_id)s
order by l.created_at desc
"""


# ------------------------------------------------------------------ relation types
def list_types(cur: psycopg.Cursor) -> list[dict]:
    return fetch_all(
        cur,
        f"select {RELATION_COLUMNS} from relation_types order by is_seeded desc, lower(name) asc",
    )


def get_type(cur: psycopg.Cursor, relation_type_id: UUID) -> dict | None:
    return fetch_one(
        cur, f"select {RELATION_COLUMNS} from relation_types where id = %(id)s",
        {"id": relation_type_id},
    )


def get_type_by_name(cur: psycopg.Cursor, name: str) -> dict | None:
    return fetch_one(
        cur,
        f"select {RELATION_COLUMNS} from relation_types where lower(name) = lower(%(name)s)",
        {"name": name.strip()},
    )


def create_type(cur: psycopg.Cursor, payload: RelationTypeCreate) -> dict:
    name = payload.name.strip().lower().replace(" ", "_")
    if get_type_by_name(cur, name) is not None:
        raise conflict(f"relation type '{name}' already exists")
    return insert_returning(
        cur,
        "relation_types",
        {"name": name, "description": payload.description, "is_seeded": False},
        returning=RELATION_COLUMNS,
    )


def ensure_types(cur: psycopg.Cursor, names: list[str]) -> list[dict]:
    resolved: list[dict] = []
    for name in names:
        existing = get_type_by_name(cur, name)
        if existing is None:
            existing = insert_returning(
                cur,
                "relation_types",
                {
                    "name": name.strip().lower().replace(" ", "_"),
                    "description": None,
                    "is_seeded": False,
                },
                returning=RELATION_COLUMNS,
            )
        resolved.append(existing)
    return resolved


def delete_type(cur: psycopg.Cursor, relation_type_id: UUID) -> bool:
    row = get_type(cur, relation_type_id)
    if row is None:
        return False
    if row.get("is_seeded"):
        raise conflict("seeded relation types cannot be deleted; rename is not supported either")
    in_use = fetch_one(
        cur,
        "select count(*) as n from item_links where relation_type_id = %(id)s",
        {"id": relation_type_id},
    )
    if int((in_use or {}).get("n", 0)) > 0:
        raise conflict("relation type is still used by existing links")
    return execute(cur, "delete from relation_types where id = %(id)s", {"id": relation_type_id}) > 0


# ------------------------------------------------------------------------- links
def list_for_item(cur: psycopg.Cursor, item_id: UUID) -> list[dict]:
    return fetch_all(cur, LINK_SELECT, {"item_id": item_id})


def get_link(cur: psycopg.Cursor, link_id: UUID, *, item_id: UUID | None = None) -> dict | None:
    if item_id is not None:
        return fetch_one(
            cur,
            LINK_SELECT.replace("where l.source_item_id", "where l.id = %(link_id)s and (l.source_item_id")
            + " or l.target_item_id = %(item_id)s)",
            {"item_id": item_id, "link_id": link_id},
        )
    return fetch_one(
        cur,
        "select id, source_item_id, target_item_id, relation_type_id, source_segment_id, note, "
        "created_at from item_links where id = %(id)s",
        {"id": link_id},
    )


def create_link(
    cur: psycopg.Cursor,
    *,
    source_item_id: UUID,
    target_item_id: UUID,
    relation_type_id: UUID,
    source_segment_id: UUID | None = None,
    note: str | None = None,
    item_id_for_view: UUID | None = None,
) -> dict | None:
    inserted = fetch_one(
        cur,
        "insert into item_links (source_item_id, target_item_id, relation_type_id, "
        "source_segment_id, note) values (%(source)s, %(target)s, %(relation)s, %(segment)s, %(note)s) "
        "on conflict (source_item_id, target_item_id, relation_type_id) do nothing returning id",
        {
            "source": source_item_id,
            "target": target_item_id,
            "relation": relation_type_id,
            "segment": source_segment_id,
            "note": note,
        },
    )
    if inserted is None:
        return None
    return get_link(cur, inserted["id"], item_id=item_id_for_view or source_item_id)


def delete_link(cur: psycopg.Cursor, link_id: UUID) -> bool:
    return execute(cur, "delete from item_links where id = %(id)s", {"id": link_id}) > 0


def count_for_item(cur: psycopg.Cursor, item_id: UUID) -> int:
    row = fetch_one(
        cur,
        "select count(*) as n from item_links "
        "where source_item_id = %(item_id)s or target_item_id = %(item_id)s",
        {"item_id": item_id},
    )
    return int((row or {}).get("n", 0))
