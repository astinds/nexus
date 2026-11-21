"""Metadata blueprint persistence (user-defined conceptual schemas)."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..errors import conflict
from ..models import BlueprintCreate, BlueprintUpdate
from .base import execute, fetch_all, fetch_one, insert_returning, update_returning

BLUEPRINT_COLUMNS = "id, name, description, default_formats, fields_schema, created_at"


def list_all(cur: psycopg.Cursor) -> list[dict]:
    return fetch_all(
        cur, f"select {BLUEPRINT_COLUMNS} from metadata_blueprints order by lower(name) asc"
    )


def get(cur: psycopg.Cursor, blueprint_id: UUID) -> dict | None:
    return fetch_one(
        cur,
        f"select {BLUEPRINT_COLUMNS} from metadata_blueprints where id = %(id)s",
        {"id": blueprint_id},
    )


def get_by_name(cur: psycopg.Cursor, name: str) -> dict | None:
    return fetch_one(
        cur,
        f"select {BLUEPRINT_COLUMNS} from metadata_blueprints where lower(name) = lower(%(name)s)",
        {"name": name.strip()},
    )


def create(cur: psycopg.Cursor, payload: BlueprintCreate) -> dict:
    if get_by_name(cur, payload.name) is not None:
        raise conflict(f"blueprint '{payload.name}' already exists")
    return insert_returning(
        cur,
        "metadata_blueprints",
        {
            "name": payload.name.strip(),
            "description": payload.description,
            "default_formats": [fmt.value for fmt in payload.default_formats],
            "fields_schema": payload.fields_schema.model_dump(mode="json"),
        },
        returning=BLUEPRINT_COLUMNS,
    )


def update(cur: psycopg.Cursor, blueprint_id: UUID, payload: BlueprintUpdate) -> dict | None:
    values: dict = {}
    if payload.name is not None:
        values["name"] = payload.name.strip()
    if payload.description is not None:
        values["description"] = payload.description
    if payload.default_formats is not None:
        values["default_formats"] = [fmt.value for fmt in payload.default_formats]
    if payload.fields_schema is not None:
        values["fields_schema"] = payload.fields_schema.model_dump(mode="json")
    if not values:
        return get(cur, blueprint_id)
    return update_returning(
        cur,
        "metadata_blueprints",
        ident={"id": blueprint_id},
        values=values,
        returning=BLUEPRINT_COLUMNS,
    )


def delete(cur: psycopg.Cursor, blueprint_id: UUID) -> bool:
    return (
        execute(cur, "delete from metadata_blueprints where id = %(id)s", {"id": blueprint_id}) > 0
    )
