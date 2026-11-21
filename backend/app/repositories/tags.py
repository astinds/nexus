"""Tag persistence, aliases and the one-click merge that stops tag sprawl."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..models import TagCreate, TagUpdate
from ..text import unique_in_order
from .base import execute, fetch_all, fetch_one, insert_returning, update_returning

TAG_COLUMNS = "t.id, t.name, t.aliases, t.created_at"

_ITEM_COUNT = "(select count(*) from item_tags it where it.tag_id = t.id) as item_count"


def list_all(cur: psycopg.Cursor) -> list[dict]:
    return fetch_all(
        cur,
        f"select {TAG_COLUMNS}, {_ITEM_COUNT} from tags t order by lower(t.name) asc",
    )


def get(cur: psycopg.Cursor, tag_id: UUID) -> dict | None:
    return fetch_one(
        cur,
        f"select {TAG_COLUMNS}, {_ITEM_COUNT} from tags t where t.id = %(id)s",
        {"id": tag_id},
    )


def find_by_name(cur: psycopg.Cursor, name: str) -> dict | None:
    """Case-insensitive match on either the canonical name or an alias."""
    return fetch_one(
        cur,
        f"select {TAG_COLUMNS}, {_ITEM_COUNT} from tags t "
        "where lower(t.name) = lower(%(name)s) "
        "or lower(%(name)s) = any (select lower(a) from unnest(t.aliases) a) "
        "limit 1",
        {"name": name.strip()},
    )


def create(cur: psycopg.Cursor, payload: TagCreate) -> dict:
    return insert_returning(
        cur,
        "tags",
        {"name": payload.name.strip(), "aliases": unique_in_order(payload.aliases)},
    )


def update(cur: psycopg.Cursor, tag_id: UUID, payload: TagUpdate) -> dict | None:
    values: dict = {}
    if payload.name is not None:
        values["name"] = payload.name.strip()
    if payload.aliases is not None:
        values["aliases"] = unique_in_order(payload.aliases)
    if not values:
        return get(cur, tag_id)
    update_returning(cur, "tags", ident={"id": tag_id}, values=values)
    return get(cur, tag_id)


def delete(cur: psycopg.Cursor, tag_id: UUID) -> bool:
    return execute(cur, "delete from tags where id = %(id)s", {"id": tag_id}) > 0


def ensure(cur: psycopg.Cursor, names: list[str]) -> list[dict]:
    """Find-or-create every name, collapsing case and alias duplicates."""
    resolved: list[dict] = []
    for name in unique_in_order(names):
        existing = find_by_name(cur, name)
        if existing:
            resolved.append(existing)
        else:
            created = create(cur, TagCreate(name=name))
            created.setdefault("item_count", 0)
            resolved.append(created)
    return resolved


def merge(cur: psycopg.Cursor, source_id: UUID, target_id: UUID) -> int:
    """Move every item link from source to target, fold aliases, delete source."""
    source = get(cur, source_id)
    target = get(cur, target_id)
    if source is None or target is None:
        return -1

    moved = execute(
        cur,
        "insert into item_tags (item_id, tag_id) "
        "select item_id, %(target)s from item_tags where tag_id = %(source)s "
        "on conflict (item_id, tag_id) do nothing",
        {"source": source_id, "target": target_id},
    )
    execute(cur, "delete from item_tags where tag_id = %(source)s", {"source": source_id})

    folded = unique_in_order(
        list(target.get("aliases") or []) + [source["name"]] + list(source.get("aliases") or [])
    )
    update_returning(
        cur, "tags", ident={"id": target_id}, values={"aliases": folded}
    )
    delete(cur, source_id)
    return max(moved, 0)


def for_item(cur: psycopg.Cursor, item_id: UUID) -> list[dict]:
    return fetch_all(
        cur,
        f"select {TAG_COLUMNS}, {_ITEM_COUNT} from tags t "
        "join item_tags it on it.tag_id = t.id where it.item_id = %(item_id)s "
        "order by lower(t.name) asc",
        {"item_id": item_id},
    )


def attach(cur: psycopg.Cursor, item_id: UUID, tag_id: UUID) -> None:
    execute(
        cur,
        "insert into item_tags (item_id, tag_id) values (%(item_id)s, %(tag_id)s) "
        "on conflict (item_id, tag_id) do nothing",
        {"item_id": item_id, "tag_id": tag_id},
    )


def detach(cur: psycopg.Cursor, item_id: UUID, tag_id: UUID) -> bool:
    return (
        execute(
            cur,
            "delete from item_tags where item_id = %(item_id)s and tag_id = %(tag_id)s",
            {"item_id": item_id, "tag_id": tag_id},
        )
        > 0
    )


def attach_names(cur: psycopg.Cursor, item_id: UUID, names: list[str]) -> list[dict]:
    tags = ensure(cur, names)
    for tag in tags:
        attach(cur, item_id, tag["id"])
    return tags


def replace_for_item(cur: psycopg.Cursor, item_id: UUID, names: list[str]) -> list[dict]:
    execute(cur, "delete from item_tags where item_id = %(item_id)s", {"item_id": item_id})
    return attach_names(cur, item_id, names)
