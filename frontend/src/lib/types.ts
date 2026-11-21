/**
 * TypeScript types matching FastAPI /api/v1 schemas exactly.
 * Generated from backend/app/models/ items.py, common.py, library.py
 */

// -----------------------------------------------------------------------------
// Shared enums & pagination
// -----------------------------------------------------------------------------

export type SourceFormat =
  | 'pdf'
  | 'docx'
  | 'markdown'
  | 'text'
  | 'csv'
  | 'json'
  | 'web_article'
  | 'note';

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'partial'
  | 'needs_enrichment'
  | 'failed';

export type TriageStatus =
  | 'inbox'
  | 'reading'
  | 'processed'
  | 'evergreen'
  | 'cold_archive';

export type SegmentStatus = 'ok' | 'empty' | 'scanned' | 'failed' | 'skipped';

export type ParaType = 'project' | 'area' | 'resource' | 'archive';

export type SavedViewKind = 'library' | 'search';

export type ExportFormat = 'markdown' | 'json' | 'bibtex' | 'apa' | 'mla';

export type TimeBudget = 'quick' | 'medium' | 'deep';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'url';

export interface BlueprintFieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  default: unknown | null;
  required: boolean;
  help: string | null;
}

export interface BlueprintFieldValue {
  key: string;
  value: unknown;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// -----------------------------------------------------------------------------
// Segments
// -----------------------------------------------------------------------------

export interface SegmentCreate {
  segment_index: number;
  segment_label: string;
  content: string;
  is_scanned: boolean;
  extraction_status: SegmentStatus;
  metadata: Record<string, unknown>;
}

export interface Segment {
  id: string;
  item_id: string;
  segment_index: number;
  segment_label: string;
  content: string;
  is_scanned: boolean;
  extraction_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SegmentIntegrity {
  segments: number;
  pages: number;
  extracted: number;
  scanned: number;
  empty: number;
  failed: number;
  partial: boolean;
  scanned_labels: string[];
  failed_labels: string[];
  engine: string | null;
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

export interface ItemCreate {
  title: string | null;
  source_format: SourceFormat;
  source_uri: string | null;
  blueprint_id: string | null;
  triage_status: TriageStatus;
  collection_ids: string[];
  tags: string[];
  custom_fields: BlueprintFieldValue[];
  metadata: Record<string, unknown>;
  note_content: string | null;
}

export interface ItemUpdate {
  title: string | null;
  blueprint_id: string | null;
  triage_status: TriageStatus | null;
  collection_ids: string[] | null;
  tags: string[] | null;
  custom_fields: BlueprintFieldValue[] | null;
  metadata: Record<string, unknown> | null;
}

export interface TriageUpdate {
  triage_status: TriageStatus;
}

export interface NoteContentUpdate {
  content: string;
}

export interface ItemLinkCreate {
  target_item_id: string;
  relation_type_id: string;
  note: string | null;
}

export interface ItemLinkView {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relation_type_id: string;
  relation_name: string;
  relation_forward: string;
  relation_reverse: string;
  note: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  workspace_id: string;
  title: string | null;
  source_format: SourceFormat;
  blueprint_id: string | null;
  blueprint_name: string | null;
  triage_status: TriageStatus;
  est_read_minutes: number;
  word_count: number;
  metadata: Record<string, unknown>;
  custom_fields: BlueprintFieldValue[];
  collections: Collection[];
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface ItemDetail extends Item {
  segments: Segment[];
  links: ItemLinkView[];
  backlinks: ItemLinkView[];
  segment_integrity: SegmentIntegrity;
}

export interface ProgressUpdate {
  item_id: string;
  segment_index: number;
}

// -----------------------------------------------------------------------------
// Ingest
// -----------------------------------------------------------------------------

export interface IngestTextRequest {
  text: string;
  source_format: SourceFormat;
  title: string | null;
  blueprint_id: string | null;
  triage_status: TriageStatus;
  collection_ids: string[];
  tags: string[];
  custom_fields: BlueprintFieldValue[];
}

export interface IngestUrlRequest {
  url: string;
  title: string | null;
  blueprint_id: string | null;
  triage_status: TriageStatus;
  collection_ids: string[];
  tags: string[];
  custom_fields: BlueprintFieldValue[];
  force_paste_fallback: boolean;
}

export interface IngestFormatsResponse {
  formats: SourceFormat[];
  extractors: Record<string, boolean>;
  file_only: SourceFormat[];
  paste_supported: SourceFormat[];
}

export interface IngestResult {
  item: Item;
  segments: Segment[];
  warnings: string[];
  deduplication: { duplicate: boolean; existing_item_id: string | null };
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

export interface SearchHit {
  item_id: string;
  title: string;
  source_format: string;
  triage_status: string;
  est_read_minutes: number;
  segment_id: string | null;
  segment_index: number | null;
  segment_label: string | null;
  snippet: string;
  rank: number;
}

export interface SearchResponse {
  query: string;
  mode: 'fulltext' | 'fallback';
  hits: SearchHit[];
  total: number;
  limit: number;
  offset: number;
  facets: Record<string, Record<string, number>>;
}

export interface LibraryFilters {
  workspace_id?: string | null;
  source_format: SourceFormat | null;
  blueprint_id?: string | null;
  triage_status?: TriageStatus | null;
  collection_id?: string | null;
  tag?: string | null;
  time_budget?: TimeBudget | null;
  q?: string | null;
  sort: 'recent' | 'created' | 'title' | 'reading_time' | 'word_count';
  limit: number;
  offset: number;
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export interface DashboardStats {
  totals: Record<string, number>;
  by_format: Record<string, number>;
  by_blueprint: Record<string, number>;
  by_triage: Record<string, number>;
  scanned_segments: number;
  failed_extractions: number;
  continue_reading: Item[];
  recently_added: Item[];
  recent_activity: ActivityLog[];
}

// -----------------------------------------------------------------------------
// Catalog: Workspaces, Blueprints, Collections, Tags, Relation Types
// -----------------------------------------------------------------------------

export interface WorkspaceCreate {
  name: string;
  slug: string | null;
  description: string | null;
  is_default: boolean;
}

export interface WorkspaceUpdate {
  name: string | null;
  description: string | null;
  is_default: boolean | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

export interface BlueprintCreate {
  name: string;
  description: string | null;
  fields_schema: BlueprintFieldSpec[];
}

export interface BlueprintUpdate {
  name: string | null;
  description: string | null;
  fields_schema: BlueprintFieldSpec[] | null;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string | null;
  fields_schema: BlueprintFieldSpec[];
  created_at: string;
  updated_at: string;
}

export interface CollectionCreate {
  name: string;
  parent_id: string | null;
  description: string | null;
  color: string | null;
  para_type: ParaType | null;
}

export interface CollectionUpdate {
  name: string | null;
  parent_id: string | null;
  description: string | null;
  color: string | null;
  para_type: ParaType | null;
}

export interface Collection {
  id: string;
  workspace_id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  color: string | null;
  para_type: ParaType | null;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  aliases: string[];
  usage_count: number;
  created_at: string;
}

export interface RelationType {
  id: string;
  name: string;
  forward: string;
  reverse: string;
  description: string | null;
}

// -----------------------------------------------------------------------------
// Studio: Saved Views, Prompt Templates, Preferences
// -----------------------------------------------------------------------------

export interface SavedViewCreate {
  name: string;
  kind: SavedViewKind;
  config: Record<string, unknown>;
  is_pinned: boolean;
}

export interface SavedViewUpdate {
  name: string | null;
  config: Record<string, unknown> | null;
  is_pinned: boolean | null;
}

export interface SavedView {
  id: string;
  workspace_id: string | null;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  is_pinned: boolean;
  created_at: string;
}

export interface PromptTemplateCreate {
  name: string;
  body: string;
  description: string | null;
}

export interface PromptTemplateUpdate {
  name: string | null;
  body: string | null;
  description: string | null;
}

export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
  description: string | null;
  created_at: string;
}

export interface PreferencesUpdate {
  payload: Record<string, unknown>;
}

export interface Preferences {
  payload: Record<string, unknown>;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export interface ActivityLog {
  id: string;
  item_id: string | null;
  kind: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// -----------------------------------------------------------------------------
// System / Auth / Health
// -----------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  auth: {
    mode: 'dev_open' | 'passcode';
    dev_open_access: boolean;
  };
  database: Record<string, unknown>;
  storage: Record<string, unknown>;
  extractors: Record<string, boolean>;
  engines: Record<string, boolean>;
  limits: {
    max_upload_mb: number;
    page_size_default: number;
    page_size_max: number;
  };
  warnings: string[];
}

export interface SessionResponse {
  authenticated: boolean;
  mode: 'dev_open' | 'key' | 'locked';
}

export interface MetaResponse {
  api: string;
  auth: {
    header: string;
    cookie: string;
    session_endpoint: string;
  };
  pagination: {
    limit_param: string;
    offset_param: string;
    max_limit: number;
  };
  error_shape: {
    error: {
      code: string;
      message: string;
      detail: string | null;
    };
  };
  triage_statuses: TriageStatus[];
  source_formats: SourceFormat[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    detail: unknown | null;
  };
}
