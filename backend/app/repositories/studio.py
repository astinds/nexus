"""Studio payloads: saved views (pinned Smart Lenses), prompt templates and the
singleton user_preferences row."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from ..models import (
    PromptTemplateCreate,
    PromptTemplateUpdate,
    PreferencesUpdate,
    SavedViewCreate,
    SavedViewUpdate,
)
from .base import execute, fetch_all, fetch_one, insert_returning, update_returning

VIEW_COLUMNS = "id, workspace_id, name, kind, config, is_pinned, created_at"
PROMPT_COLUMNS = "id, name, body, description, created_at"


# -------------------------------------------------------------------- saved views
def list_views(cur: psycopg.Cursor, *, pinned_only: bool = False) -> list[dict]:
    clause = " where is_pinned" if pinned_only else ""
    return fetch_all(
        cur,
        f"select {VIEW_COLUMNS} from saved_views{clause} order by is_pinned desc, created_at desc",
    )


def get_view(cur: psycopg.Cursor, view_id: UUID) -> dict | None:
    return fetch_one(cur, f"select {VIEW_COLUMNS} from saved_views where id = %(id)s", {"id": view_id})


def create_view(cur: psycopg.Cursor, payload: SavedViewCreate) -> dict:
    return insert_returning(
        cur,
        "saved_views",
        {
            "name": payload.name.strip(),
            "workspace_id": payload.workspace_id,
            "kind": payload.kind.value,
            "config": Jsonb(payload.config),
            "is_pinned": payload.is_pinned,
        },
        returning=VIEW_COLUMNS,
    )


def update_view(cur: psycopg.Cursor, view_id: UUID, payload: SavedViewUpdate) -> dict | None:
    values: dict[str, Any] = payload.model_dump(exclude_unset=True)
    if "config" in values:
        values["config"] = Jsonb(values["config"])
    if not values:
        return get_view(cur, view_id)
    return update_returning(
        cur, "saved_views", ident={"id": view_id}, values=values, returning=VIEW_COLUMNS
    )


def toggle_pin(cur: psycopg.Cursor, view_id: UUID, *, pinned: bool) -> dict | None:
    return update_returning(
        cur, "saved_views", ident={"id": view_id}, values={"is_pinned": pinned},
        returning=VIEW_COLUMNS,
    )


def delete_view(cur: psycopg.Cursor, view_id: UUID) -> bool:
    return execute(cur, "delete from saved_views where id = %(id)s", {"id": view_id}) > 0


# --------------------------------------------------------------- prompt templates
def list_prompts(cur: psycopg.Cursor) -> list[dict]:
    return fetch_all(cur, f"select {PROMPT_COLUMNS} from prompt_templates order by lower(name) asc")


def get_prompt(cur: psycopg.Cursor, prompt_id: UUID) -> dict | None:
    return fetch_one(
        cur, f"select {PROMPT_COLUMNS} from prompt_templates where id = %(id)s", {"id": prompt_id}
    )


def create_prompt(cur: psycopg.Cursor, payload: PromptTemplateCreate) -> dict:
    return insert_returning(
        cur,
        "prompt_templates",
        {
            "name": payload.name.strip(),
            "body": payload.body,
            "description": payload.description,
        },
        returning=PROMPT_COLUMNS,
    )


def update_prompt(
    cur: psycopg.Cursor, prompt_id: UUID, payload: PromptTemplateUpdate
) -> dict | None:
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return get_prompt(cur, prompt_id)
    return update_returning(
        cur, "prompt_templates", ident={"id": prompt_id}, values=values, returning=PROMPT_COLUMNS
    )


def delete_prompt(cur: psycopg.Cursor, prompt_id: UUID) -> bool:
    return execute(cur, "delete from prompt_templates where id = %(id)s", {"id": prompt_id}) > 0


# -------------------------------------------------------------------- preferences
def get_preferences(cur: psycopg.Cursor) -> dict:
    row = fetch_one(cur, "select payload, updated_at from user_preferences where id = 1")
    if row is None:
        row = insert_returning(
            cur, "user_preferences", {"id": 1, "payload": Jsonb({})},
            returning="payload, updated_at",
        )
    return row


def update_preferences(cur: psycopg.Cursor, payload: PreferencesUpdate) -> dict:
    """Shallow merge: a token sent as null removes it, anything else is replaced."""
    current = get_preferences(cur)
    merged = dict(current.get("payload") or {})
    for key, value in payload.payload.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return update_returning(
        cur,
        "user_preferences",
        ident={"id": 1},
        values={"payload": Jsonb(merged)},
        returning="payload, updated_at",
    ) or current
