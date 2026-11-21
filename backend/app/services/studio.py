"""Studio services: Smart Lenses (saved views), prompt templates, preferences."""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..errors import not_found
from ..models import (
    Preferences,
    PreferencesUpdate,
    PromptTemplate,
    PromptTemplateCreate,
    PromptTemplateUpdate,
    SavedView,
    SavedViewCreate,
    SavedViewUpdate,
)
from ..repositories import studio
from ..text import truncate

# Sensible defaults so a fresh install renders correctly before the user saves
# anything. Keys are CSS custom properties; unknown keys are preserved as-is.
DEFAULT_PREFERENCES: dict[str, object] = {
    "font_family": "editorial-serif",
    "font_scale": 1.0,
    "reading_width": "68ch",
    "accent": "#7c9cf5",
    "palette": "obsidian",
    "dark": True,
    "density": "comfortable",
}


def resolved_preferences(cur: psycopg.Cursor) -> Preferences:
    row = studio.get_preferences(cur)
    payload = {**DEFAULT_PREFERENCES, **(row.get("payload") or {})}
    return Preferences(payload=payload, updated_at=row["updated_at"])


def update_preferences(cur: psycopg.Cursor, payload: PreferencesUpdate) -> Preferences:
    row = studio.update_preferences(cur, payload)
    return resolved_preferences(cur) if row is None else Preferences(**row)


# -------------------------------------------------------------------- saved views
def list_views(cur: psycopg.Cursor, *, pinned_only: bool = False) -> list[SavedView]:
    return [SavedView(**row) for row in studio.list_views(cur, pinned_only=pinned_only)]


def create_view(cur: psycopg.Cursor, payload: SavedViewCreate) -> SavedView:
    return SavedView(**studio.create_view(cur, payload))


def update_view(cur: psycopg.Cursor, view_id: UUID, payload: SavedViewUpdate) -> SavedView:
    row = studio.update_view(cur, view_id, payload)
    if row is None:
        raise not_found("saved view", view_id)
    return SavedView(**row)


def toggle_pin(cur: psycopg.Cursor, view_id: UUID, *, pinned: bool) -> SavedView:
    row = studio.toggle_pin(cur, view_id, pinned=pinned)
    if row is None:
        raise not_found("saved view", view_id)
    return SavedView(**row)


def delete_view(cur: psycopg.Cursor, view_id: UUID) -> dict:
    if not studio.delete_view(cur, view_id):
        raise not_found("saved view", view_id)
    return {"deleted": True, "view_id": str(view_id)}


# ------------------------------------------------------------------ prompts
def list_prompts(cur: psycopg.Cursor) -> list[PromptTemplate]:
    return [PromptTemplate(**row) for row in studio.list_prompts(cur)]


def create_prompt(cur: psycopg.Cursor, payload: PromptTemplateCreate) -> PromptTemplate:
    return PromptTemplate(**studio.create_prompt(cur, payload))


def update_prompt(cur: psycopg.Cursor, prompt_id: UUID, payload: PromptTemplateUpdate) -> PromptTemplate:
    row = studio.update_prompt(cur, prompt_id, payload)
    if row is None:
        raise not_found("prompt template", prompt_id)
    return PromptTemplate(**row)


def delete_prompt(cur: psycopg.Cursor, prompt_id: UUID) -> dict:
    if not studio.delete_prompt(cur, prompt_id):
        raise not_found("prompt template", prompt_id)
    return {"deleted": True, "prompt_id": str(prompt_id)}


def render_prompt(cur: psycopg.Cursor, prompt_id: UUID, item_id: UUID) -> dict[str, str]:
    """'Copy with Item Context': template body plus a compact item header.

    No model is called. The user copies the text into any assistant, which keeps
    NEXUS model-agnostic and free.
    """
    from ..repositories import items as items_repo

    row = studio.get_prompt(cur, prompt_id)
    if row is None:
        raise not_found("prompt template", prompt_id)
    item = items_repo.get(cur, item_id)
    if item is None:
        raise not_found("item", item_id)

    header = "\n".join(
        [
            f"# {item['title']}",
            f"- format: {item['source_format']}",
            f"- reading time: {item['est_read_minutes']} min",
            f"- source: {item.get('source_uri') or 'n/a'}",
        ]
    )
    segments = items_repo.list_segments(cur, item_id)
    excerpt = "\n\n".join(
        f"[{segment['segment_label']}]\n{truncate(segment['content'], 1200)}"
        for segment in segments[:12]
        if segment["content"].strip()
    )
    body = f"{row['body'].strip()}\n\n---\n{header}\n\n{excerpt}".strip()
    return {"name": row["name"], "text": body[:20000]}
