/**
 * Typed API client for the NEXUS FastAPI backend.
 * All requests flow through the Next.js rewrites proxy at /api/:path*
 * which forwards to the backend at API_BACKEND_URL.
 */

import {
  ActivityLog,
  Blueprint,
  BlueprintCreate,
  BlueprintUpdate,
  Collection,
  CollectionCreate,
  CollectionUpdate,
  DashboardStats,
  HealthResponse,
  IngestFormatsResponse,
  IngestResult,
  IngestTextRequest,
  IngestUrlRequest,
  Item,
  ItemCreate,
  ItemDetail,
  ItemLinkCreate,
  ItemUpdate,
  LibraryFilters,
  Preferences,
  PreferencesUpdate,
  ProgressUpdate,
  PromptTemplate,
  PromptTemplateCreate,
  PromptTemplateUpdate,
  SavedView,
  SavedViewCreate,
  SavedViewUpdate,
  SearchResponse,
  SessionResponse,
  SourceFormat,
  Tag,
  TriageStatus,
  TimeBudget,
} from './types';

const API_BASE = '/api/v1';

// -----------------------------------------------------------------------------
// Low-level fetch wrapper
// -----------------------------------------------------------------------------

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      const body = await res.json();
      if (body?.error?.code) {
        detail = body.error.detail ?? body.error.message;
      }
    } catch {
      // ignore body parse errors
    }
    throw new Error(`API error ${res.status}: ${JSON.stringify(detail)}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// -----------------------------------------------------------------------------
// Health & auth
// -----------------------------------------------------------------------------

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export async function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/auth/session');
}

export async function unlockSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/auth/session', { method: 'POST' });
}

export async function lockSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/auth/session', { method: 'DELETE' });
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export async function getDashboard(
  workspaceId?: string | null
): Promise<DashboardStats> {
  const params = new URLSearchParams();
  if (workspaceId) params.set('workspace_id', workspaceId);
  const qs = params.toString();
  return request<DashboardStats>(`/dashboard${qs ? `?${qs}` : ''}`);
}

// -----------------------------------------------------------------------------
// Library / items
// -----------------------------------------------------------------------------

export async function getItems(
  filters: LibraryFilters
): Promise<import('./types').Page<Item>> {
  const params = new URLSearchParams();
  if (filters.workspace_id) params.set('workspace_id', filters.workspace_id);
  if (filters.source_format) params.set('source_format', filters.source_format);
  if (filters.blueprint_id) params.set('blueprint_id', filters.blueprint_id);
  if (filters.triage_status) params.set('triage_status', filters.triage_status);
  if (filters.collection_id) params.set('collection_id', filters.collection_id);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.time_budget) params.set('time_budget', filters.time_budget);
  if (filters.q) params.set('q', filters.q);
  if (filters.sort) params.set('sort', filters.sort);
  params.set('limit', String(filters.limit || 50));
  params.set('offset', String(filters.offset || 0));

  const qs = params.toString();
  return request<import('./types').Page<Item>>(`/items${qs ? `?${qs}` : ''}`);
}

export async function getItem(itemId: string): Promise<ItemDetail> {
  return request<ItemDetail>(`/items/${itemId}`);
}

export async function createItem(
  payload: Omit<ItemCreate, 'id'> & { id?: string }
): Promise<IngestResult> {
  return request<IngestResult>('/items', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateItem(
  itemId: string,
  payload: ItemUpdate
): Promise<Item> {
  return request<Item>(`/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function setTriage(
  itemId: string,
  triageStatus: TriageStatus
): Promise<Item> {
  return request<Item>(`/items/${itemId}/triage`, {
    method: 'POST',
    body: JSON.stringify({ triage_status: triageStatus }),
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  return request<void>(`/items/${itemId}`, { method: 'DELETE' });
}

export async function updateProgress(
  itemId: string,
  segmentIndex: number
): Promise<Item> {
  const payload: ProgressUpdate = { item_id: itemId, segment_index: segmentIndex };
  return request<Item>(`/items/${itemId}/progress`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getSegment(
  itemId: string,
  segmentIndex: number
): Promise<import('./types').Segment> {
  return request<import('./types').Segment>(
    `/items/${itemId}/segments/${segmentIndex}`
  );
}

// Download file endpoint returns a streamed Response - handle separately.

// -----------------------------------------------------------------------------
// Ingest
// -----------------------------------------------------------------------------

export async function getIngestFormats(): Promise<IngestFormatsResponse> {
  return request<IngestFormatsResponse>('/ingest/formats');
}

export async function ingestText(
  payload: IngestTextRequest
): Promise<IngestResult> {
  return request<IngestResult>('/ingest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function ingestUrl(
  payload: IngestUrlRequest
): Promise<IngestResult> {
  return request<IngestResult>('/ingest/url', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

export async function search(
  query: string,
  filters: {
    source_format?: SourceFormat;
    blueprint_id?: string | null;
    triage_status?: TriageStatus;
    collection_id?: string | null;
    tag?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(filters.limit || 50) });
  if (filters.source_format) params.set('source_format', filters.source_format);
  if (filters.blueprint_id) params.set('blueprint_id', filters.blueprint_id);
  if (filters.triage_status) params.set('triage_status', filters.triage_status);
  if (filters.collection_id) params.set('collection_id', filters.collection_id);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.offset) params.set('offset', String(filters.offset));

  const qs = params.toString();
  return request<SearchResponse>(`/search${qs ? `?${qs}` : ''}`);
}

// -----------------------------------------------------------------------------
// Saved views / smart lenses
// -----------------------------------------------------------------------------

export async function getSavedViews(pinnedOnly?: boolean): Promise<SavedView[]> {
  const qs = pinnedOnly ? '?pinned_only=true' : '';
  return request<SavedView[]>(`/saved-views${qs}`);
}

export async function createSavedView(
  payload: SavedViewCreate
): Promise<SavedView> {
  return request<SavedView>('/saved-views', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSavedView(
  viewId: string,
  payload: SavedViewUpdate
): Promise<SavedView> {
  return request<SavedView>(`/saved-views/${viewId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function pinSavedView(
  viewId: string,
  pinned: boolean
): Promise<SavedView> {
  return request<SavedView>(`/saved-views/${viewId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ is_pinned: pinned }),
  });
}

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export async function getActivity(limit = 20): Promise<ActivityLog[]> {
  return request<ActivityLog[]>(`/activity?limit=${limit}`);
}

// -----------------------------------------------------------------------------
// Catalog: workspaces, blueprints, collections, tags, relation types
// -----------------------------------------------------------------------------

export async function getWorkspaces(): Promise<import('./types').Workspace[]> {
  return request<import('./types').Workspace[]>('/workspaces');
}

export async function getBlueprints(): Promise<Blueprint[]> {
  return request<Blueprint[]>('/blueprints');
}

export async function getCollections(): Promise<Collection[]> {
  return request<Collection[]>('/collections');
}

export async function getTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags');
}

export async function getRelationTypes(): Promise<import('./types').RelationType[]> {
  return request<import('./types').RelationType[]>('/relation-types');
}

// -----------------------------------------------------------------------------
// Studio: prompt templates, preferences
// -----------------------------------------------------------------------------

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  return request<PromptTemplate[]>('/prompt-templates');
}

export async function getPreferences(): Promise<Preferences> {
  return request<Preferences>('/preferences');
}

export async function updatePreferences(
  payload: PreferencesUpdate
): Promise<Preferences> {
  return request<Preferences>('/preferences', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
