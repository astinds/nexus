'use client';

import {
  SOURCE_FORMATS,
  TIME_BUDGETS,
  TRIAGE_STATUSES,
  type Blueprint,
  type Collection,
  type SourceFormat,
  type Tag,
  type TimeBudget,
  type TriageStatus,
} from '@/lib/types';

export interface LibraryFilterState {
  source_format: SourceFormat | '';
  blueprint_id: string;
  triage_status: TriageStatus | '';
  time_budget: TimeBudget | '';
  collection_id: string;
  tag: string;
}

const selectClass =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]';

/** The six library facets, kept in one place so the page stays readable. */
export default function FilterBar({
  filters,
  onChange,
  collections,
  tags,
  blueprints,
  lensName,
  onLensName,
  onSaveLens,
  onReset,
  notice,
}: {
  filters: LibraryFilterState;
  onChange: <K extends keyof LibraryFilterState>(key: K, value: LibraryFilterState[K]) => void;
  collections: Collection[];
  tags: Tag[];
  blueprints: Blueprint[];
  lensName: string;
  onLensName: (value: string) => void;
  onSaveLens: () => void;
  onReset: () => void;
  notice: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select
          aria-label="Format"
          className={selectClass}
          value={filters.source_format}
          onChange={(e) => onChange('source_format', e.target.value as SourceFormat | '')}
        >
          <option value="">All formats</option>
          {SOURCE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {format.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          aria-label="Blueprint"
          className={selectClass}
          value={filters.blueprint_id}
          onChange={(e) => onChange('blueprint_id', e.target.value)}
        >
          <option value="">All blueprints</option>
          {blueprints.map((bp) => (
            <option key={bp.id} value={bp.id}>
              {bp.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Triage status"
          className={selectClass}
          value={filters.triage_status}
          onChange={(e) => onChange('triage_status', e.target.value as TriageStatus | '')}
        >
          <option value="">Any status</option>
          {TRIAGE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          aria-label="Time budget"
          className={selectClass}
          value={filters.time_budget}
          onChange={(e) => onChange('time_budget', e.target.value as TimeBudget | '')}
        >
          <option value="">Any length</option>
          {TIME_BUDGETS.map((budget) => (
            <option key={budget.value} value={budget.value}>
              {budget.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Collection"
          className={selectClass}
          value={filters.collection_id}
          onChange={(e) => onChange('collection_id', e.target.value)}
        >
          <option value="">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Tag"
          className={selectClass}
          value={filters.tag}
          onChange={(e) => onChange('tag', e.target.value)}
        >
          <option value="">Any tag</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.name}>
              {tag.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <input
          value={lensName}
          onChange={(e) => onLensName(e.target.value)}
          placeholder="Lens name"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={onSaveLens}
          disabled={!lensName.trim()}
          className="rounded-lg border border-[var(--border)] px-2 py-1.5 opacity-80 hover:opacity-100 disabled:opacity-40"
        >
          Save as Smart Lens
        </button>
        <button type="button" onClick={onReset} className="opacity-50 hover:opacity-100">
          Reset filters
        </button>
        {notice ? <span className="opacity-60">{notice}</span> : null}
      </div>
    </div>
  );
}
