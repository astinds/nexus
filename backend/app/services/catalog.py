"""Catalog services: workspaces, blueprints, collections, tags, relation types.

Thin orchestration over repositories: validation lives in Pydantic models,
persistence in repositories, activity logging here.
"""

from __future__ import annotations

from uuid import UUID

import psycopg

from ..errors import bad_request, not_found
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
from ..repositories import activity, blueprints, collections, relations, tags, workspaces


# --------------------------------------------------------------------- workspaces
def list_workspaces(cur: psycopg.Cursor) -> list[Workspace]:
    return [Workspace(**row) for row in workspaces.list_all(cur)]


def get_workspace(cur: psycopg.Cursor, workspace_id: UUID) -> Workspace:
    row = workspaces.get(cur, workspace_id)
    if row is None:
        raise not_found("workspace", workspace_id)
    return Workspace(**row)


def create_workspace(cur: psycopg.Cursor, payload: WorkspaceCreate) -> Workspace:
    row = workspaces.create(cur, payload)
    activity.log(cur, "workspace.created", f"Created workspace {row['name']}")
    return Workspace(**row)


def update_workspace(cur: psycopg.Cursor, workspace_id: UUID, payload: WorkspaceUpdate) -> Workspace:
    row = workspaces.update(cur, workspace_id, payload)
    if row is None:
        raise not_found("workspace", workspace_id)
    return Workspace(**row)


def delete_workspace(cur: psycopg.Cursor, workspace_id: UUID) -> dict:
    if workspaces.count(cur) <= 1:
        raise bad_request("the last workspace cannot be deleted", code="last_workspace")
    deleted = workspaces.delete(cur, workspace_id)
    if not deleted:
        raise not_found("workspace", workspace_id)
    activity.log(cur, "workspace.deleted", "Deleted a workspace")
    return {"deleted": True, "workspace_id": str(workspace_id)}


# --------------------------------------------------------------------- blueprints
def list_blueprints(cur: psycopg.Cursor) -> list[Blueprint]:
    return [Blueprint(**row) for row in blueprints.list_all(cur)]


def get_blueprint(cur: psycopg.Cursor, blueprint_id: UUID) -> Blueprint:
    row = blueprints.get(cur, blueprint_id)
    if row is None:
        raise not_found("blueprint", blueprint_id)
    return Blueprint(**row)


def create_blueprint(cur: psycopg.Cursor, payload: BlueprintCreate) -> Blueprint:
    row = blueprints.create(cur, payload)
    activity.log(cur, "blueprint.created", f"Created blueprint {row['name']}")
    return Blueprint(**row)


def update_blueprint(cur: psycopg.Cursor, blueprint_id: UUID, payload: BlueprintUpdate) -> Blueprint:
    row = blueprints.update(cur, blueprint_id, payload)
    if row is None:
        raise not_found("blueprint", blueprint_id)
    return Blueprint(**row)


def delete_blueprint(cur: psycopg.Cursor, blueprint_id: UUID) -> dict:
    deleted = blueprints.delete(cur, blueprint_id)
    if not deleted:
        raise not_found("blueprint", blueprint_id)
    activity.log(cur, "blueprint.deleted", "Deleted a blueprint")
    return {"deleted": True, "blueprint_id": str(blueprint_id)}


# -------------------------------------------------------------------- collections
def list_collections(
    cur: psycopg.Cursor, *, workspace_id: UUID | None = None, as_tree: bool = False
) -> list[Collection] | list[CollectionNode]:
    rows = collections.list_all(cur, workspace_id=workspace_id)
    if as_tree:
        return _as_nodes(collections.build_tree(rows))
    return [Collection(**row) for row in rows]


def _as_nodes(nodes: list[dict]) -> list[CollectionNode]:
    return [
        CollectionNode(**{**node, "children": _as_nodes(node.get("children") or [])})
        for node in nodes
    ]


def create_collection(cur: psycopg.Cursor, payload: CollectionCreate) -> Collection:
    if workspaces.get(cur, payload.workspace_id) is None:
        raise not_found("workspace", payload.workspace_id)
    if payload.parent_id is not None:
        parent = collections.get(cur, payload.parent_id)
        if parent is None:
            raise not_found("parent collection", payload.parent_id)
        if parent["workspace_id"] != payload.workspace_id:
            raise bad_request("parent collection belongs to another workspace", code="cross_workspace")
    row = collections.create(cur, payload)
    activity.log(cur, "collection.created", f"Created collection {row['name']}")
    return Collection(**row)


def update_collection(cur: psycopg.Cursor, collection_id: UUID, payload: CollectionUpdate) -> Collection:
    existing = collections.get(cur, collection_id)
    if existing is None:
        raise not_found("collection", collection_id)
    if payload.parent_id is not None:
        if payload.parent_id == collection_id:
            raise bad_request("a collection cannot be its own parent", code="cycle")
        descendants = set(collections.descendant_ids(cur, collection_id))
        if payload.parent_id in descendants:
            raise bad_request(
                "cannot move a collection under one of its own children", code="cycle"
            )
    row = collections.update(cur, collection_id, payload)
    if row is None:
        raise not_found("collection", collection_id)
    return Collection(**row)


def delete_collection(cur: psycopg.Cursor, collection_id: UUID) -> dict:
    deleted = collections.delete(cur, collection_id)
    if not deleted:
        raise not_found("collection", collection_id)
    activity.log(cur, "collection.deleted", "Deleted a collection")
    return {"deleted": True, "collection_id": str(collection_id)}


# --------------------------------------------------------------------------- tags
def list_tags(cur: psycopg.Cursor) -> list[Tag]:
    return [Tag(**row) for row in tags.list_all(cur)]


def create_tag(cur: psycopg.Cursor, payload: TagCreate) -> Tag:
    existing = tags.find_by_name(cur, payload.name)
    if existing is not None:
        raise bad_request(
            f"tag '{payload.name}' already exists (or is an alias of '{existing['name']}')",
            code="duplicate_tag",
        )
    row = tags.create(cur, payload)
    row.setdefault("item_count", 0)
    return Tag(**row)


def update_tag(cur: psycopg.Cursor, tag_id: UUID, payload: TagUpdate) -> Tag:
    if payload.name is not None:
        clash = tags.find_by_name(cur, payload.name)
        if clash is not None and clash["id"] != tag_id:
            raise bad_request(
                f"'{payload.name}' is already used by tag '{clash['name']}'",
                code="duplicate_tag",
            )
    row = tags.update(cur, tag_id, payload)
    if row is None:
        raise not_found("tag", tag_id)
    return Tag(**row)


def delete_tag(cur: psycopg.Cursor, tag_id: UUID) -> dict:
    deleted = tags.delete(cur, tag_id)
    if not deleted:
        raise not_found("tag", tag_id)
    return {"deleted": True, "tag_id": str(tag_id)}


def merge_tags(cur: psycopg.Cursor, payload: TagMergeRequest) -> TagMergeResult:
    source = tags.get(cur, payload.source_tag_id)
    if source is None:
        raise not_found("source tag", payload.source_tag_id)
    target = tags.get(cur, payload.target_tag_id)
    if target is None:
        raise not_found("target tag", payload.target_tag_id)

    moved = tags.merge(cur, payload.source_tag_id, payload.target_tag_id)
    merged = tags.get(cur, payload.target_tag_id)
    assert merged is not None
    activity.log(
        cur,
        "tag.merged",
        f"Merged tag '{source['name']}' into '{target['name']}'",
        metadata={
            "source": str(payload.source_tag_id),
            "target": str(payload.target_tag_id),
            "moved": moved,
        },
    )
    return TagMergeResult(
        target_tag=Tag(**merged),
        moved_items=moved,
        deleted_tag_id=payload.source_tag_id,
    )


# ---------------------------------------------------------------- relation types
def list_relation_types(cur: psycopg.Cursor) -> list[RelationType]:
    return [RelationType(**row) for row in relations.list_types(cur)]


def create_relation_type(cur: psycopg.Cursor, payload: RelationTypeCreate) -> RelationType:
    row = relations.create_type(cur, payload)
    activity.log(cur, "relation_type.created", f"Created relation type {row['name']}")
    return RelationType(**row)


def delete_relation_type(cur: psycopg.Cursor, relation_type_id: UUID) -> dict:
    deleted = relations.delete_type(cur, relation_type_id)
    if not deleted:
        raise not_found("relation type", relation_type_id)
    return {"deleted": True, "relation_type_id": str(relation_type_id)}
