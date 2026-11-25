/**
 * TypeScript mirrors of the FastAPI models in backend/app/models/.
 *
 * Every shape here is checked against the Pydantic model it mirrors; when a
 * backend model changes, this file changes with it. Response models are
 * `extra="forbid"` on input only, so responses may carry fields listed here
 * and nothing else is relied upon.
 */

// -----------------------------------------------------------------------------
// Enums (backend/app/models/common.py)
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

export const SOURCE_FORMATS: SourceFormat[] = [
  'pdf',
  'docx',
  'markdown',
  'text',
  'csv',
  'json',
  'web_article',
  'note',
];

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

export const TRIAGE_STATUSES: TriageStatus[] = [
  'inbox',
  'reading',
  'processed',
  'evergreen',
  'cold_archive',
];

export type SegmentStatus = 'ok' | 'empty' | 'scanned' | 'failed' | 'skipped';

export type ParaType = 'project' | 'area' | 'resource' | 'archive';

export const PARA_TYPES: ParaType[] = ['project', 'area', 'resource', 'archive'];

export type SavedViewKind = 'library' | 'search';

export type ExportFormat = 'markdown' | 'json' | 'bibtex' | 'apa' | 'mla';

export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'markdown', label: 'Markdown + YAML' },
  { value: 'json', label: 'JSON' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'apa', label: 'APA' },
  { value: 'mla', label: 'MLA' },
];

export type TimeBudget = 'quick' | 'medium' | 'deep';

export const TIME_BUDGETS: { value: TimeBudget; label: string }[] = [
  { value: 'quick', label: '< 5 min' },
  { value: 'medium', label: '15–30 min' },
  { value: 'deep', label: 'Deep study' },
];

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'url';

export const FIELD_TYPES: FieldType[] = [
  'text',
  'number',
  'date',
  'select',
  'boolean',
  'url',
];

/** `Page[T]` from common.py. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** `{"error": {...}}` from app/errors.py. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    detail: unknown | null;
  };
}

// -----------------------------------------------------------------------------
// Segments (items.py)
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Annotations (annotations.py) — page-anchored reader notes and highlights
// -----------------------------------------------------------------------------

export interface Annotation {
  id: string;
  item_id: string;
  segment_index: number | null;
  segment_label: string | null;
  quote_text: string | null;
  note_body: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface AnnotationCreate {
  segment_index?: number | null;
  segment_label?: string | null;
  quote_text?: string | null;
  note_body?: string;
  color?: string;
}

export interface AnnotationUpdate {
  segment_index?: number | null;
  segment_label?: string | null;
  quote_text?: string | null;
  note_body?: string;
  color?: string;
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
// Items (items.py)
// -----------------------------------------------------------------------------

export interface Item {
  id: string;
  workspace_id: string;
  blueprint_id: string | null;
  title: string;
  source_format: string;
  source_uri: string | null;
  snapshot_uri: string | null;
  mime_type: string | null;
  file_size: number | null;
  word_count: number;
  est_read_minutes: number;
  content_hash: string | null;
  processing_status: string;
  triage_status: string;
  reading_progress: Record<string, unknown>;
  error_message: string | null;
  summary: string | null;
  custom_fields: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ItemLinkView {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relation_type_id: string;
  relation_name: string | null;
  source_segment_id: string | null;
  note: string | null;
  created_at: string;
}

/** `ItemDetail` — item plus everything the inspector drawer needs. */
export interface ItemDetail extends Item {
  tags: Tag[];
  collections: Collection[];
  segments: Segment[] | null;
  links: ItemLinkView[];
  integrity: SegmentIntegrity | null;
  blueprint_fields: BlueprintFieldSpec[];
}

export interface ItemCreate {
  title?: string | null;
  source_format?: SourceFormat;
  workspace_id?: string | null;
  blueprint_id?: string | null;
  source_uri?: string | null;
  mime_type?: string | null;
  content?: string | null;
  triage_status?: TriageStatus;
  custom_fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  collection_ids?: string[];
}

export interface ItemUpdate {
  title?: string;
  blueprint_id?: string | null;
  triage_status?: TriageStatus;
  summary?: string | null;
  custom_fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Full replacement of the item's tag set. */
  tags?: string[];
  /** Full replacement of the item's collection membership. */
  collection_ids?: string[];
}

export interface TriageUpdate {
  triage_status: TriageStatus;
}

export interface ProgressUpdate {
  segment_index?: number;
  segment_label?: string;
  percent?: number;
  location?: Record<string, unknown>;
}

export interface NoteContentUpdate {
  content: string;
}

export interface ItemLinkCreate {
  target_item_id: string;
  relation_type_id: string;
  note?: string | null;
}

// -----------------------------------------------------------------------------
// Ingest (items.py)
// -----------------------------------------------------------------------------

export interface IngestResult {
  item: Item;
  duplicate: boolean;
  segments_created: number;
  warnings: string[];
  engine: string | null;
  integrity: SegmentIntegrity | null;
}

export interface IngestFormats {
  formats: string[];
  extractors: Record<string, unknown>;
  file_only: string[];
  paste_supported: string[];
}

// -----------------------------------------------------------------------------
// Search (items.py)
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

// -----------------------------------------------------------------------------
// Dashboard (items.py)
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
// Catalog (library.py)
// -----------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

export interface WorkspaceCreate {
  name: string;
  slug?: string | null;
  description?: string | null;
  is_default?: boolean;
}

export interface WorkspaceUpdate {
  name?: string;
  description?: string | null;
  is_default?: boolean;
}

export interface BlueprintFieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  default?: unknown | null;
  required: boolean;
  help?: string | null;
}

export interface BlueprintFieldsSchema {
  fields: BlueprintFieldSpec[];
}

export interface Blueprint {
  id: string;
  name: string;
  description: string | null;
  default_formats: string[];
  fields_schema: BlueprintFieldsSchema;
  created_at: string;
}

export interface BlueprintCreate {
  name: string;
  description?: string | null;
  default_formats?: SourceFormat[];
  fields_schema?: BlueprintFieldsSchema;
}

export interface BlueprintUpdate {
  name?: string;
  description?: string | null;
  default_formats?: SourceFormat[];
  fields_schema?: BlueprintFieldsSchema;
}

export interface Collection {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  para_type: string | null;
  parent_id: string | null;
  created_at: string;
}

export interface CollectionNode extends Collection {
  children: CollectionNode[];
}

export interface CollectionCreate {
  workspace_id: string;
  name: string;
  description?: string | null;
  para_type?: ParaType | null;
  parent_id?: string | null;
}

export interface CollectionUpdate {
  name?: string;
  description?: string | null;
  para_type?: ParaType | null;
  parent_id?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  aliases: string[];
  created_at: string;
  item_count: number;
}

export interface TagMergeRequest {
  source_tag_id: string;
  target_tag_id: string;
}

export interface TagMergeResult {
  target_tag: Tag;
  moved_items: number;
  deleted_tag_id: string;
}

export interface RelationType {
  id: string;
  name: string;
  description: string | null;
}

export interface RelationTypeCreate {
  name: string;
  description?: string | null;
}

// -----------------------------------------------------------------------------
// Studio (library.py)
// -----------------------------------------------------------------------------

export interface SavedView {
  id: string;
  workspace_id: string | null;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  is_pinned: boolean;
  created_at: string;
}

export interface SavedViewCreate {
  name: string;
  workspace_id?: string | null;
  kind?: SavedViewKind;
  config?: Record<string, unknown>;
  is_pinned?: boolean;
}

export interface SavedViewUpdate {
  name?: string;
  config?: Record<string, unknown>;
  is_pinned?: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
  description: string | null;
  created_at: string;
}

export interface PromptTemplateCreate {
  name: string;
  body: string;
  description?: string | null;
}

export interface PromptTemplateUpdate {
  name?: string;
  body?: string;
  description?: string | null;
}

/** Keys the backend seeds in `resolved_preferences` (services/studio.py). */
export interface PreferencePayload {
  font_family: string;
  font_scale: number;
  reading_width: string;
  accent: string;
  palette: string;
  dark: boolean;
  density: string;
  [key: string]: unknown;
}

export interface Preferences {
  payload: PreferencePayload;
  updated_at: string;
}

export interface PreferencesUpdate {
  payload: PreferencePayload;
}

// -----------------------------------------------------------------------------
// Activity (library.py)
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
// System (system.py)
// -----------------------------------------------------------------------------

export interface ExtractorInfo {
  name: string;
  formats: string[];
  extensions: string[];
}

export interface EngineInfo {
  engine: string;
  available: boolean;
  detail: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  auth: {
    mode: 'dev_open' | 'passcode';
    dev_open_access: boolean;
  };
  database: Record<string, unknown>;
  storage: Record<string, unknown>;
  extractors: ExtractorInfo[];
  engines: EngineInfo[];
  limits: {
    max_upload_mb: number;
    page_size_default: number;
    page_size_max: number;
  };
  warnings: string[];
}

export interface SessionResponse {
  authenticated: boolean;
  /** `passcode` is returned by POST (cookie just set); `key` by GET (cookie valid). */
  mode: 'dev_open' | 'key' | 'passcode' | 'locked';
}
