"""Workspace, blueprint, collection, tag and relation-type routes."""

from __future__ import annotations

from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query, status

from ..auth import AuthContext, require_access
from ..models import (
    Blueprint,
    BlueprintCreate,
    BlueprintUpdate,
    Collection,
    CollectionCreate,
    CollectionNode,
    CollectionUpdate,
    RelationType,
    RelationTypeCreate,
    Tag,
    TagCreate,
    TagMergeRequest,
    TagMergeResult,
    TagUpdate,
    Workspace,
    WorkspaceCreate,
    WorkspaceUpdate,
)
from ..services import catalog
from .deps import get_cursor

guard = Depends(require_access)
router = APIRouter(tags=["catalog"], dependencies=[guard])


# --------------------------------------------------------------------- workspaces
@router.get("/workspaces", response_model=list[Workspace], summary="List workspaces")
def list_workspaces(
    cur: psycopg.Cursor = Depends(get_cursor), _: AuthContext = guard
) -> list[Workspace]:
    return catalog.list_workspaces(cur)


@router.post(
    "/workspaces",
    response_model=Workspace,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace",
)
def create_workspace(
    payload: WorkspaceCreate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Workspace:
    return catalog.create_workspace(cur, payload)


@router.get("/workspaces/{workspace_id}", response_model=Workspace, summary="Get a workspace")
def get_workspace(workspace_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> Workspace:
    return catalog.get_workspace(cur, workspace_id)


@router.patch("/workspaces/{workspace_id}", response_model=Workspace, summary="Update a workspace")
def update_workspace(
    workspace_id: UUID, payload: WorkspaceUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Workspace:
    return catalog.update_workspace(cur, workspace_id, payload)


@router.delete("/workspaces/{workspace_id}", summary="Delete a workspace and its contents")
def delete_workspace(workspace_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return catalog.delete_workspace(cur, workspace_id)


# --------------------------------------------------------------------- blueprints
@router.get("/blueprints", response_model=list[Blueprint], summary="List metadata blueprints")
def list_blueprints(cur: psycopg.Cursor = Depends(get_cursor)) -> list[Blueprint]:
    return catalog.list_blueprints(cur)


@router.post(
    "/blueprints",
    response_model=Blueprint,
    status_code=status.HTTP_201_CREATED,
    summary="Create a metadata blueprint",
)
def create_blueprint(payload: BlueprintCreate, cur: psycopg.Cursor = Depends(get_cursor)) -> Blueprint:
    return catalog.create_blueprint(cur, payload)


@router.get("/blueprints/{blueprint_id}", response_model=Blueprint, summary="Get a blueprint")
def get_blueprint(blueprint_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> Blueprint:
    return catalog.get_blueprint(cur, blueprint_id)


@router.patch("/blueprints/{blueprint_id}", response_model=Blueprint, summary="Update a blueprint")
def update_blueprint(
    blueprint_id: UUID, payload: BlueprintUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Blueprint:
    return catalog.update_blueprint(cur, blueprint_id, payload)


@router.delete("/blueprints/{blueprint_id}", summary="Delete a blueprint")
def delete_blueprint(blueprint_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return catalog.delete_blueprint(cur, blueprint_id)


# -------------------------------------------------------------------- collections
@router.get(
    "/collections",
    response_model=list[Collection],
    summary="List collections (flat or as a tree)",
)
def list_collections(
    workspace_id: UUID | None = Query(default=None),
    tree: bool = Query(default=False, description="Return nested children instead of a flat list"),
    cur: psycopg.Cursor = Depends(get_cursor),
):
    return catalog.list_collections(cur, workspace_id=workspace_id, as_tree=tree)


@router.get(
    "/collections/tree",
    response_model=list[CollectionNode],
    summary="Collections as a nested tree",
)
def collection_tree(
    workspace_id: UUID | None = Query(default=None),
    cur: psycopg.Cursor = Depends(get_cursor),
) -> list[CollectionNode]:
    return catalog.list_collections(cur, workspace_id=workspace_id, as_tree=True)


@router.post(
    "/collections",
    response_model=Collection,
    status_code=status.HTTP_201_CREATED,
    summary="Create a collection",
)
def create_collection(
    payload: CollectionCreate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Collection:
    return catalog.create_collection(cur, payload)


@router.patch("/collections/{collection_id}", response_model=Collection, summary="Update a collection")
def update_collection(
    collection_id: UUID, payload: CollectionUpdate, cur: psycopg.Cursor = Depends(get_cursor)
) -> Collection:
    return catalog.update_collection(cur, collection_id, payload)


@router.delete("/collections/{collection_id}", summary="Delete a collection")
def delete_collection(collection_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return catalog.delete_collection(cur, collection_id)


# --------------------------------------------------------------------------- tags
@router.get("/tags", response_model=list[Tag], summary="List tags with usage counts")
def list_tags(cur: psycopg.Cursor = Depends(get_cursor)) -> list[Tag]:
    return catalog.list_tags(cur)


@router.post("/tags", response_model=Tag, status_code=status.HTTP_201_CREATED, summary="Create a tag")
def create_tag(payload: TagCreate, cur: psycopg.Cursor = Depends(get_cursor)) -> Tag:
    return catalog.create_tag(cur, payload)


@router.patch("/tags/{tag_id}", response_model=Tag, summary="Rename a tag or edit aliases")
def update_tag(tag_id: UUID, payload: TagUpdate, cur: psycopg.Cursor = Depends(get_cursor)) -> Tag:
    return catalog.update_tag(cur, tag_id, payload)


@router.delete("/tags/{tag_id}", summary="Delete a tag (links are removed, items stay)")
def delete_tag(tag_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return catalog.delete_tag(cur, tag_id)


@router.post(
    "/tags/merge",
    response_model=TagMergeResult,
    summary="Merge tag A into tag B (one-click cleanup)",
)
def merge_tags(payload: TagMergeRequest, cur: psycopg.Cursor = Depends(get_cursor)) -> TagMergeResult:
    return catalog.merge_tags(cur, payload)


# ---------------------------------------------------------------- relation types
@router.get(
    "/relation-types",
    response_model=list[RelationType],
    summary="List relation types (seeded + user-defined)",
)
def list_relation_types(cur: psycopg.Cursor = Depends(get_cursor)) -> list[RelationType]:
    return catalog.list_relation_types(cur)


@router.post(
    "/relation-types",
    response_model=RelationType,
    status_code=status.HTTP_201_CREATED,
    summary="Create a relation type",
)
def create_relation_type(
    payload: RelationTypeCreate, cur: psycopg.Cursor = Depends(get_cursor)
) -> RelationType:
    return catalog.create_relation_type(cur, payload)


@router.delete("/relation-types/{relation_type_id}", summary="Delete an unused relation type")
def delete_relation_type(relation_type_id: UUID, cur: psycopg.Cursor = Depends(get_cursor)) -> dict:
    return catalog.delete_relation_type(cur, relation_type_id)
