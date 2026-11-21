"""Models for the library catalog: workspaces, blueprints, collections, tags,
relation types, saved views, prompt templates, preferences and activity."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from .common import NexusModel, ParaType, SavedViewKind, SourceFormat

FIELD_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,48}$")
MAX_BLUEPRINT_FIELDS = 40
FieldType = Literal["text", "number", "date", "select", "boolean", "url"]


# --------------------------------------------------------------------- workspaces
class WorkspaceCreate(NexusModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False


class WorkspaceUpdate(NexusModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool | None = None


class Workspace(NexusModel):
    id: UUID
    name: str
    slug: str
    description: str | None = None
    is_default: bool = False
    created_at: datetime


# --------------------------------------------------------------------- blueprints
class BlueprintFieldSpec(NexusModel):
    """One custom field on a conceptual schema (Book, Research Paper, ...)."""

    key: str = Field(min_length=1, max_length=49)
    label: str = Field(min_length=1, max_length=120)
    type: FieldType = "text"
    options: list[str] = Field(default_factory=list)
    default: Any | None = None
    required: bool = False
    help: str | None = Field(default=None, max_length=400)

    @field_validator("key")
    @classmethod
    def _snake_case(cls, value: str) -> str:
        value = value.strip().lower().replace(" ", "_").replace("-", "_")
        if not FIELD_KEY_RE.match(value):
            raise ValueError(
                "field keys must be lower_snake_case, start with a letter, max 49 chars"
            )
        return value

    @model_validator(mode="after")
    def _select_needs_options(self) -> "BlueprintFieldSpec":
        if self.type == "select" and not self.options:
            raise ValueError(f"select field '{self.key}' needs at least one option")
        return self


class BlueprintFieldsSchema(NexusModel):
    fields: list[BlueprintFieldSpec] = Field(default_factory=list, max_length=MAX_BLUEPRINT_FIELDS)

    @field_validator("fields")
    @classmethod
    def _unique_keys(cls, fields: list[BlueprintFieldSpec]) -> list[BlueprintFieldSpec]:
        seen: set[str] = set()
        for field in fields:
            if field.key in seen:
                raise ValueError(f"duplicate blueprint field key '{field.key}'")
            seen.add(field.key)
        return fields


class BlueprintCreate(NexusModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    default_formats: list[SourceFormat] = Field(default_factory=list)
    fields_schema: BlueprintFieldsSchema = Field(default_factory=BlueprintFieldsSchema)


class BlueprintUpdate(NexusModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    default_formats: list[SourceFormat] | None = None
    fields_schema: BlueprintFieldsSchema | None = None


class Blueprint(NexusModel):
    id: UUID
    name: str
    description: str | None = None
    default_formats: list[str] = Field(default_factory=list)
    fields_schema: BlueprintFieldsSchema = Field(default_factory=BlueprintFieldsSchema)
    created_at: datetime


# -------------------------------------------------------------------- collections
class CollectionCreate(NexusModel):
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    para_type: ParaType | None = None
    parent_id: UUID | None = None


class CollectionUpdate(NexusModel):
    """Partial update. `name` is NOT NULL; `parent_id = null` detaches the collection."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    para_type: ParaType | None = None
    parent_id: UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_null_name(cls, data: Any) -> Any:
        if isinstance(data, dict) and "name" in data and data["name"] is None:
            raise ValueError("name cannot be null; omit it to keep the current name")
        return data


class Collection(NexusModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    para_type: str | None = None
    parent_id: UUID | None = None
    created_at: datetime


class CollectionNode(Collection):
    children: list["CollectionNode"] = Field(default_factory=list)


# --------------------------------------------------------------------------- tags
class TagCreate(NexusModel):
    name: str = Field(min_length=1, max_length=80)
    aliases: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("name")
    @classmethod
    def _trim(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("tag name cannot be blank")
        return cleaned


class TagUpdate(NexusModel):
    """Partial update. `name` is NOT NULL, so a null is rejected as 422."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    aliases: list[str] | None = Field(default=None, max_length=40)

    @model_validator(mode="before")
    @classmethod
    def _reject_null_name(cls, data: Any) -> Any:
        if isinstance(data, dict) and "name" in data and data["name"] is None:
            raise ValueError("name cannot be null; omit it to keep the current name")
        return data


class Tag(NexusModel):
    id: UUID
    name: str
    aliases: list[str] = Field(default_factory=list)
    created_at: datetime
    item_count: int = 0


class TagMergeRequest(NexusModel):
    """Merge source into target: every link moves, then source is deleted."""

    source_tag_id: UUID
    target_tag_id: UUID

    @model_validator(mode="after")
    def _distinct(self) -> "TagMergeRequest":
        if self.source_tag_id == self.target_tag_id:
            raise ValueError("source and target tags must differ")
        return self


class TagMergeResult(NexusModel):
    target_tag: Tag
    moved_items: int
    deleted_tag_id: UUID


# ------------------------------------------------------------------ relation types
class RelationTypeCreate(NexusModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=400)


class RelationType(NexusModel):
    id: UUID
    name: str
    description: str | None = None
    is_seeded: bool = False
    created_at: datetime


# ------------------------------------------------------- saved views / prompts
class SavedViewCreate(NexusModel):
    name: str = Field(min_length=1, max_length=120)
    workspace_id: UUID | None = None
    kind: SavedViewKind = SavedViewKind.library
    config: dict[str, Any] = Field(default_factory=dict)
    is_pinned: bool = False


class SavedViewUpdate(NexusModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    config: dict[str, Any] | None = None
    is_pinned: bool | None = None


class SavedView(NexusModel):
    id: UUID
    workspace_id: UUID | None = None
    name: str
    kind: str
    config: dict[str, Any] = Field(default_factory=dict)
    is_pinned: bool = False
    created_at: datetime


class PromptTemplateCreate(NexusModel):
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=8000)
    description: str | None = Field(default=None, max_length=400)


class PromptTemplateUpdate(NexusModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=8000)
    description: str | None = Field(default=None, max_length=400)


class PromptTemplate(NexusModel):
    id: UUID
    name: str
    body: str
    description: str | None = None
    created_at: datetime


# --------------------------------------------------------------------- preferences
class PreferencesUpdate(NexusModel):
    """Free-form UI preferences: typography, palette, accent, reading width.

    Stored as JSONB so new tokens need no migration; the frontend ships defaults.
    """

    payload: dict[str, Any]


class Preferences(NexusModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime


# ------------------------------------------------------------------------ activity
class ActivityLog(NexusModel):
    id: UUID
    item_id: UUID | None = None
    kind: str
    message: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
