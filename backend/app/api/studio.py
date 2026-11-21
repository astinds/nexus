"""Studio + dashboard routes: smart lenses, prompt templates, preferences, stats."""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, status

from ..auth import require_access
from ..models import (
    DashboardStats,
    Preferences,
    PreferencesUpdate,
    PromptTemplate,
    PromptTemplateCreate,
    PromptTemplateUpdate,
    SavedView,
    SavedViewCreate,
    SavedViewUpdate,
)
from ..repositories import activity as activity_repo
from ..services import studio as studio_service
from .deps import get_cursor

router = APIRouter(tags=["studio"], dependencies=[Depends(require_access)])


# ------------------------------------------------------------------- saved views
@router.get("/saved-views", response_model=list[SavedView], summary="List Smart Lenses")
def list_views(
    pinned_only: bool = Query(default=False), cur: psycopg.Cursor = Depends(get_cursor)
) -> list[SavedView]:
    return studio_service.list_views(cur, pinned_only=pinned_only)


@router.post(
    "/saved-views",
    response_model=SavedView,
    status_code=status.HTTP_201_CREATED,
    summary="Save the current filters as a Smart Lens",
)
def create_view(payload: SavedViewCreate, cur: psycopg.Cursor = Depends(get_cursor)) -> SavedView:
    return studio_service.create_view(cur, payload)


@router.patch("/saved-views/{view_id}", response_model=SavedView, summary="Update a Smart Lens")
def update_view(
    view_id: UUID, payload: SavedViewUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> SavedView:
    return studio_service.update_view(cur, view_id, payload)


@router.post("/saved-views/{view_id}/pin", response_model=SavedView, summary="Pin or unpin a lens")
def pin_view(
    view_id: UUID,
    pinned: bool = Query(default=True),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> SavedView:
    return studio_service.toggle_pin(cur, view_id, pinned=pinned)


@router.delete("/saved-views/{view_id}", summary="Delete a Smart Lens")
def delete_view(view_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return studio_service.delete_view(cur, view_id)


# --------------------------------------------------------------- prompt templates
@router.get("/prompt-templates", response_model=list[PromptTemplate], summary="List prompt templates")
def list_prompts(cur: psycopg.Cursor = Depends(get_cursor)) -> list[PromptTemplate]:
    return studio_service.list_prompts(cur)


@router.post(
    "/prompt-templates",
    response_model=PromptTemplate,
    status_code=status.HTTP_201_CREATED,
    summary="Create a prompt template",
)
def create_prompt(
    payload: PromptTemplateCreate, cur: psycopg.Cursor = Depends(get_cursor)
) -> PromptTemplate:
    return studio_service.create_prompt(cur, payload)


@router.patch(
    "/prompt-templates/{prompt_id}", response_model=PromptTemplate, summary="Update a prompt template"
)
def update_prompt(
    prompt_id: UUID, payload: PromptTemplateUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> PromptTemplate:
    return studio_service.update_prompt(cur, prompt_id, payload)


@router.delete("/prompt-templates/{prompt_id}", summary="Delete a prompt template")
def delete_prompt(prompt_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return studio_service.delete_prompt(cur, prompt_id)


@router.get(
    "/items/{item_id}/prompt-context",
    summary="Render a prompt template with this item's context (for copy/paste)",
)
def render_prompt(
    item_id: UUID,
    template_id: UUID = Query(..., description="Prompt template id"),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> dict[str, str]:
    return studio_service.render_prompt(cur, template_id, item_id)


# -------------------------------------------------------------------- preferences
@router.get("/preferences", response_model=Preferences, summary="Get UI preferences")
def get_preferences(cur: psycopg.Cursor = Depends(get_cursor)) -> Preferences:
    return studio_service.resolved_preferences(cur)


@router.patch("/preferences", response_model=Preferences, summary="Update UI preferences")
def update_preferences(
    payload: PreferencesUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Preferences:
    return studio_service.update_preferences(cur, payload)


# ---------------------------------------------------------------------- dashboard
@router.get("/dashboard", response_model=DashboardStats, summary="Dashboard aggregates")
def dashboard(
    workspace_id: UUID | None = Query(default=None),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> DashboardStats:
    return DashboardStats(**activity_repo.dashboard(cur, workspace_id=workspace_id))


@router.get("/activity", summary="Recent activity feed")
def recent_activity(
    limit: int = Query(default=20, ge=1, le=200), cur: psycopg.Cursor = Depends(get_cursor)
) -> list[dict]:
    return activity_repo.list_recent(cur, limit=limit)
