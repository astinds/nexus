"""Workspace persistence. The default workspace is created by migration 001."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..errors import conflict, not_found
from ..models import WorkspaceCreate, WorkspaceUpdate
from ..text import slugify
from .base import execute, fetch_all, fetch_one, insert_returning, update_returning

WORKSPACE_COLUMNS = "id, name, slug, description, is_default, created_at"


def list_all(cur: psycopg.Cursor) -> list[dict]:
    return fetch_all(
        cur,
        f"select {WORKSPACE_COLUMNS} from workspaces "
        "order by is_default desc, lower(name) asc",
    )


def get(cur: psycopg.Cursor, workspace_id: UUID) -> dict | None:
    return fetch_one(
        cur, f"select {WORKSPACE_COLUMNS} from workspaces where id = %(id)s", {"id": workspace_id}
    )


def get_by_slug(cur: psycopg.Cursor, slug: str) -> dict | None:
    return fetch_one(
        cur,
        f"select {WORKSPACE_COLUMNS} from workspaces where slug = %(slug)s",
        {"slug": slug},
    )


def get_default(cur: psycopg.Cursor) -> dict | None:
    row = fetch_one(
        cur,
        f"select {WORKSPACE_COLUMNS} from workspaces where is_default order by created_at asc limit 1",
    )
    if row:
        return row
    return fetch_one(
        cur, f"select {WORKSPACE_COLUMNS} from workspaces order by created_at asc limit 1"
    )


def require_default(cur: psycopg.Cursor) -> dict:
    row = get_default(cur)
    if row is None:
        raise not_found("workspace", "default (run `python scripts/apply_migrations.py`)")
    return row


def _unique_slug(cur: psycopg.Cursor, base: str) -> str:
    candidate = slugify(base)
    suffix = 2
    while get_by_slug(cur, candidate) is not None:
        candidate = f"{slugify(base)}-{suffix}"
        suffix += 1
        if suffix > 200:  # pragma: no cover - defensive
            raise conflict("could not derive a unique workspace slug")
    return candidate


def create(cur: psycopg.Cursor, payload: WorkspaceCreate) -> dict:
    slug = payload.slug.strip() if payload.slug else _unique_slug(cur, payload.name)
    if get_by_slug(cur, slug) is not None:
        raise conflict(f"workspace slug '{slug}' is already taken")
    if payload.is_default:
        execute(cur, "update workspaces set is_default = false where is_default")
    return insert_returning(
        cur,
        "workspaces",
        {
            "name": payload.name.strip(),
            "slug": slug,
            "description": payload.description,
            "is_default": payload.is_default,
        },
    )


def update(cur: psycopg.Cursor, workspace_id: UUID, payload: WorkspaceUpdate) -> dict | None:
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_default"):
        execute(
            cur,
            "update workspaces set is_default = false where is_default and id <> %(id)s",
            {"id": workspace_id},
        )
    if not values:
        return get(cur, workspace_id)
    return update_returning(
        cur, "workspaces", ident={"id": workspace_id}, values=values,
        returning=WORKSPACE_COLUMNS,
    )


def delete(cur: psycopg.Cursor, workspace_id: UUID) -> bool:
    """Deletes the workspace and (by FK cascade) everything inside it."""
    return execute(cur, "delete from workspaces where id = %(id)s", {"id": workspace_id}) > 0


def count(cur: psycopg.Cursor) -> int:
    row = fetch_one(cur, "select count(*) as n from workspaces")
    return int((row or {}).get("n", 0))
