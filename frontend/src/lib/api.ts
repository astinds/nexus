/**
 * Typed client for the NEXUS FastAPI backend.
 *
 * Every call goes to `/api/v1/...` on the current origin; next.config.mjs
 * rewrites that prefix to API_BACKEND_URL server-side, so the browser never
 * makes a cross-origin request and cookies stay same-origin (ADR-010).
 */

import type {
  ActivityLog,
  Annotation,
  AnnotationCreate,
  AnnotationUpdate,
  Blueprint,
  BlueprintCreate,
  BlueprintUpdate,
  Collection,
  CollectionCreate,
  CollectionNode,
  CollectionUpdate,
  DashboardStats,
  ExportFormat,
  HealthResponse,
  IngestFormats,
  IngestResult,
  Item,
  ItemCreate,
  ItemDetail,
  ItemLinkCreate,
  ItemLinkView,
  ItemUpdate,
  NoteContentUpdate,
  Page,
  PreferencePayload,
  Preferences,
  ProgressUpdate,
  PromptTemplate,
  PromptTemplateCreate,
  PromptTemplateUpdate,
  RelationType,
  RelationTypeCreate,
  SavedView,
  SavedViewCreate,
  SavedViewUpdate,
  SearchResponse,
  SessionResponse,
  SourceFormat,
  Tag,
  TagMergeRequest,
  TagMergeResult,
  TriageStatus,
  Workspace,
  WorkspaceCreate,
  WorkspaceUpdate,
} from './types';

const BASE = '/api/v1';

/** Error carrying the backend's `error.code` so callers can branch on it. */
export class ApiError extends Error {
  status: number;
  code: string;
  detail: unknown;

  constructor(status: number, code: string, message: string, detail: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Cold-start budgets, in milliseconds.
 *
 * Render Free sleeps after 15 minutes and takes ~45 s to answer the first
 * request, so the old unbounded `fetch` could hang the UI forever and a single
 * flaky attempt looked like an outage. Health gets the full wake window; uploads
 * get the longest budget because a 25 MB PDF over mobile data is slow for
 * reasons that have nothing to do with the server.
 */
const TIMEOUT_HEALTH_MS = 60_000;
const TIMEOUT_UPLOAD_MS = 120_000;
const TIMEOUT_DEFAULT_MS = 30_000;

function timeoutFor(path: string): number {
  if (path.startsWith('/health')) return TIMEOUT_HEALTH_MS;
  if (path.startsWith('/ingest')) return TIMEOUT_UPLOAD_MS;
  return TIMEOUT_DEFAULT_MS;
}

/** GET is the only verb we retry: replaying a POST could duplicate an item. */
function isRetryable(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  return method === 'GET';
}

async function once<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const budget = timeoutFor(path);
  const timer = setTimeout(() => controller.abort(), budget);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(
        0,
        'timeout_error',
        `The NEXUS backend did not answer within ${Math.round(budget / 1000)} s.`,
      );
    }
    throw new ApiError(0, 'network_error', 'The NEXUS backend is unreachable.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = `Request failed (${res.status}).`;
    let detail: unknown = null;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        detail = body.error.detail ?? null;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await once<T>(path, init);
  } catch (error) {
    const retryable =
      isRetryable(init) &&
      error instanceof ApiError &&
      (error.status === 0 || error.status >= 500);
    if (!retryable) throw error;
    // One calm retry, spaced far enough apart to survive a cold start.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return once<T>(path, init);
  }
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ------------------------------------------------------------------- system
export const getHealth = () => request<HealthResponse>('/health');
export const getSession = () => request<SessionResponse>('/auth/session');

export const unlockSession = (key: string) =>
  request<SessionResponse>('/auth/session', {
    method: 'POST',
    headers: { 'X-Nexus-Key': key },
  });

export const lockSession = () =>
  request<SessionResponse>('/auth/session', { method: 'DELETE' });

// ---------------------------------------------------------------- dashboard
export const getDashboard = (workspaceId?: string | null) =>
  request<DashboardStats>(`/dashboard${qs({ workspace_id: workspaceId })}`);

export const getActivity = (limit = 20) =>
  request<ActivityLog[]>(`/activity${qs({ limit })}`);

// -------------------------------------------------------------------- items
export interface ItemQuery {
  workspace_id?: string | null;
  source_format?: SourceFormat | null;
  blueprint_id?: string | null;
  triage_status?: TriageStatus | null;
  collection_id?: string | null;
  tag?: string | null;
  time_budget?: string | null;
  q?: string | null;
  sort?: string;
  limit?: number;
  offset?: number;
}

export const getItems = (query: ItemQuery = {}) =>
  request<Page<Item>>(`/items${qs({ ...query })}`);

export const getItem = (itemId: string, includeSegments = true) =>
  request<ItemDetail>(`/items/${itemId}${qs({ include_segments: includeSegments })}`);

export const createItem = (payload: ItemCreate) =>
  request<IngestResult>('/items', { method: 'POST', body: JSON.stringify(payload) });

export const updateItem = (itemId: string, payload: ItemUpdate) =>
  request<Item>(`/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const setTriage = (itemId: string, triageStatus: TriageStatus) =>
  request<Item>(`/items/${itemId}/triage`, {
    method: 'POST',
    body: JSON.stringify({ triage_status: triageStatus }),
  });

export const setProgress = (itemId: string, payload: ProgressUpdate) =>
  request<Item>(`/items/${itemId}/progress`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// --------------------------------------------------------------- annotations
export const listAnnotations = (itemId: string, segment?: number | null) =>
  request<Annotation[]>(
    `/items/${itemId}/annotations${qs({ segment: segment ?? undefined })}`,
  );

export const createAnnotation = (itemId: string, payload: AnnotationCreate) =>
  request<Annotation>(`/items/${itemId}/annotations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateAnnotation = (
  itemId: string,
  annotationId: string,
  payload: AnnotationUpdate,
) =>
  request<Annotation>(`/items/${itemId}/annotations/${annotationId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deleteAnnotation = (itemId: string, annotationId: string) =>
  request<{ deleted: boolean }>(`/items/${itemId}/annotations/${annotationId}`, {
    method: 'DELETE',
  });

export const replaceNoteContent = (itemId: string, content: string) =>
  request<ItemDetail>(`/items/${itemId}/content`, {
    method: 'PUT',
    body: JSON.stringify({ content } satisfies NoteContentUpdate),
  });

export const deleteItem = (itemId: string) =>
  request<{ deleted: boolean }>(`/items/${itemId}`, { method: 'DELETE' });

// -------------------------------------------------------------------- links
export const createLink = (itemId: string, payload: ItemLinkCreate) =>
  request<ItemLinkView>(`/items/${itemId}/links`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteLink = (itemId: string, linkId: string) =>
  request<{ deleted: boolean }>(`/items/${itemId}/links/${linkId}`, { method: 'DELETE' });

// ------------------------------------------------------------------- ingest
export const getIngestFormats = () => request<IngestFormats>('/ingest/formats');

export const ingestFile = (file: File, sourceFormat: SourceFormat, title?: string) => {
  const body = new FormData();
  body.append('file', file);
  body.append('source_format', sourceFormat);
  if (title) body.append('title', title);
  return request<IngestResult>('/ingest', { method: 'POST', body });
};

export interface IngestTextPayload {
  text: string;
  source_format?: SourceFormat;
  title?: string | null;
  triage_status?: TriageStatus;
  collection_ids?: string[];
  tags?: string[];
  paste_fallback?: boolean;
}

/** Pasted text, Markdown and notes all arrive here (multipart form fields). */
export const ingestText = (payload: IngestTextPayload) => {
  const body = new FormData();
  body.append('text', payload.text);
  body.append('source_format', payload.source_format ?? 'note');
  if (payload.title) body.append('title', payload.title);
  if (payload.triage_status) body.append('triage_status', payload.triage_status);
  // The backend takes comma-separated strings, not repeated fields.
  if (payload.tags?.length) body.append('tags', payload.tags.join(','));
  if (payload.collection_ids?.length) {
    body.append('collection_ids', payload.collection_ids.join(','));
  }
  if (payload.paste_fallback) body.append('paste_fallback', 'true');
  return request<IngestResult>('/ingest', { method: 'POST', body });
};

export const ingestUrl = (payload: {
  url: string;
  title?: string | null;
  triage_status?: TriageStatus;
  tags?: string[];
  collection_ids?: string[];
}) =>
  request<IngestResult>('/ingest/url', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ------------------------------------------------------------------- search
export interface SearchQuery {
  q: string;
  source_format?: SourceFormat | null;
  blueprint_id?: string | null;
  triage_status?: TriageStatus | null;
  collection_id?: string | null;
  tag?: string | null;
  limit?: number;
  offset?: number;
}

export const search = (query: SearchQuery) =>
  request<SearchResponse>(`/search${qs({ ...query })}`);

// ------------------------------------------------------------------ export
export const exportItemUrl = (itemId: string, format: ExportFormat, download = true) =>
  `${BASE}/items/${itemId}/export/${format}${qs({ download })}`;

export const exportLibraryUrl = (workspaceId?: string | null) =>
  `${BASE}/export/library${qs({ workspace_id: workspaceId })}`;

export const itemDownloadUrl = (itemId: string) => `${BASE}/items/${itemId}/download`;

// ----------------------------------------------------------------- catalog
export const getWorkspaces = () => request<Workspace[]>('/workspaces');

export const createWorkspace = (payload: WorkspaceCreate) =>
  request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify(payload) });

export const updateWorkspace = (id: string, payload: WorkspaceUpdate) =>
  request<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteWorkspace = (id: string) =>
  request<{ deleted: boolean }>(`/workspaces/${id}`, { method: 'DELETE' });

export const getBlueprints = () => request<Blueprint[]>('/blueprints');

export const createBlueprint = (payload: BlueprintCreate) =>
  request<Blueprint>('/blueprints', { method: 'POST', body: JSON.stringify(payload) });

export const updateBlueprint = (id: string, payload: BlueprintUpdate) =>
  request<Blueprint>(`/blueprints/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteBlueprint = (id: string) =>
  request<{ deleted: boolean }>(`/blueprints/${id}`, { method: 'DELETE' });

export const getCollections = (workspaceId?: string | null) =>
  request<Collection[]>(`/collections${qs({ workspace_id: workspaceId })}`);

export const getCollectionTree = (workspaceId?: string | null) =>
  request<CollectionNode[]>(`/collections/tree${qs({ workspace_id: workspaceId })}`);

export const createCollection = (payload: CollectionCreate) =>
  request<Collection>('/collections', { method: 'POST', body: JSON.stringify(payload) });

export const updateCollection = (id: string, payload: CollectionUpdate) =>
  request<Collection>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteCollection = (id: string) =>
  request<{ deleted: boolean }>(`/collections/${id}`, { method: 'DELETE' });

export const getTags = () => request<Tag[]>('/tags');

export const createTag = (name: string) =>
  request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name }) });

export const updateTag = (
  id: string,
  payload: { name?: string; aliases?: string[] }
) => request<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const deleteTag = (id: string) =>
  request<{ deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' });

export const mergeTags = (payload: TagMergeRequest) =>
  request<TagMergeResult>('/tags/merge', { method: 'POST', body: JSON.stringify(payload) });

export const getRelationTypes = () => request<RelationType[]>('/relation-types');

export const createRelationType = (payload: RelationTypeCreate) =>
  request<RelationType>('/relation-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteRelationType = (id: string) =>
  request<{ deleted: boolean }>(`/relation-types/${id}`, { method: 'DELETE' });

// ------------------------------------------------------------------ studio
export const getSavedViews = (pinnedOnly = false) =>
  request<SavedView[]>(`/saved-views${qs({ pinned_only: pinnedOnly })}`);

export const createSavedView = (payload: SavedViewCreate) =>
  request<SavedView>('/saved-views', { method: 'POST', body: JSON.stringify(payload) });

export const updateSavedView = (id: string, payload: SavedViewUpdate) =>
  request<SavedView>(`/saved-views/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

export const pinSavedView = (id: string, pinned: boolean) =>
  request<SavedView>(`/saved-views/${id}/pin`, {
    method: 'POST',
    body: JSON.stringify({ is_pinned: pinned }),
  });

export const deleteSavedView = (id: string) =>
  request<{ deleted: boolean }>(`/saved-views/${id}`, { method: 'DELETE' });

export const getPromptTemplates = () => request<PromptTemplate[]>('/prompt-templates');

export const createPromptTemplate = (payload: PromptTemplateCreate) =>
  request<PromptTemplate>('/prompt-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updatePromptTemplate = (id: string, payload: PromptTemplateUpdate) =>
  request<PromptTemplate>(`/prompt-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deletePromptTemplate = (id: string) =>
  request<{ deleted: boolean }>(`/prompt-templates/${id}`, { method: 'DELETE' });

export const renderPromptContext = (itemId: string, templateId: string) =>
  request<{ name: string; text: string }>(
    `/items/${itemId}/prompt-context${qs({ template_id: templateId })}`
  );

// ------------------------------------------------------------- preferences
export const getPreferences = () => request<Preferences>('/preferences');

export const updatePreferences = (payload: PreferencePayload) =>
  request<Preferences>('/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ payload }),
  });
