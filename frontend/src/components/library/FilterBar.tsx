'use client';

import { useId, useState } from 'react';
import { ChevronDownIcon, SlidersIcon } from '@/components/icons';
import { formatLabel, triageLabel } from '@/lib/format';
import {
  SOURCE_FORMATS,
  TIME_BUDGETS,
  type Blueprint,
  type Collection,
  type SavedView,
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
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]';

/** The five states worth one tap; evergreen lives inside the panel. */
const QUICK_STATUSES: { value: TriageStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'reading', label: 'Reading' },
  { value: 'processed', label: 'Done' },
  { value: 'cold_archive', label: 'Archive' },
];

/** Panel-only facets; status has its own pill row, so it is not counted here. */
const PANEL_KEYS = ['source_format', 'blueprint_id', 'time_budget', 'collection_id', 'tag'] as const;

export function activeFilterCount(filters: LibraryFilterState): number {
  return PANEL_KEYS.reduce((total, key) => total + (filters[key] ? 1 : 0), 0);
}

/**
 * Two layers instead of a wall of dropdowns.
 *
 * On a phone the old six-select grid plus the Smart Lens row pushed results off
 * the first screen. Now: a scrolling row of status pills and one Filters button,
 * with the six dropdowns, lens saving and reset living in a panel that opens on
 * demand. The same markup serves desktop, where the panel simply starts closed
 * and is one tap away.
 */
export default function FilterBar({
  filters,
  onChange,
  collections,
  tags,
  blueprints,
  savedViews,
  onApplyLens,
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
  savedViews: SavedView[];
  onApplyLens: (lens: SavedView) => void;
  lensName: string;
  onLensName: (value: string) => void;
  onSaveLens: () => void;
  onReset: () => void;
  notice: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const activeCount = activeFilterCount(filters);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="Filter by status"
          className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-0.5"
        >
          {QUICK_STATUSES.map((status) => {
            const selected = filters.triage_status === status.value;
            return (
              <button
                key={status.label}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange('triage_status', status.value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {status.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
            open || activeCount > 0
              ? 'border-[var(--accent-ring)] text-[var(--text)]'
              : 'border-[var(--border)] text-[var(--text-muted)]'
          }`}
        >
          <SlidersIcon />
          Filters
          {activeCount > 0 ? (
            <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-[var(--accent-fg)]">
              {activeCount}
            </span>
          ) : null}
          <ChevronDownIcon
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            width={14}
            height={14}
          />
        </button>
      </div>

      {open ? (
        <div
          id={panelId}
          className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Format
              </span>
              <select
                className={selectClass}
                value={filters.source_format}
                onChange={(e) => onChange('source_format', e.target.value as SourceFormat | '')}
              >
                <option value="">All formats</option>
                {SOURCE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {formatLabel(format)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Blueprint
              </span>
              <select
                className={selectClass}
                value={filters.blueprint_id}
                onChange={(e) => onChange('blueprint_id', e.target.value)}
              >
                <option value="">All blueprints</option>
                {blueprints.map((blueprint) => (
                  <option key={blueprint.id} value={blueprint.id}>
                    {blueprint.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Status
              </span>
              <select
                className={selectClass}
                value={filters.triage_status}
                onChange={(e) => onChange('triage_status', e.target.value as TriageStatus | '')}
              >
                <option value="">Any status</option>
                {(['inbox', 'reading', 'processed', 'evergreen', 'cold_archive'] as TriageStatus[]).map(
                  (status) => (
                    <option key={status} value={status}>
                      {triageLabel(status)}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Time budget
              </span>
              <select
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
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Collection
              </span>
              <select
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
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Tag
              </span>
              <select
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
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 text-[11px]">
            <input
              value={lensName}
              onChange={(e) => onLensName(e.target.value)}
              placeholder="Lens name"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)] sm:flex-none"
            />
            <button
              type="button"
              onClick={onSaveLens}
              disabled={!lensName.trim()}
              className="btn-quiet rounded-lg px-2.5 py-1.5 disabled:cursor-not-allowed"
            >
              Save as Smart Lens
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Reset filters
            </button>
            {notice ? (
              <span className="text-[var(--text-subtle)]" role="status">
                {notice}
              </span>
            ) : null}
          </div>

          {savedViews.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
                Smart lenses
              </span>
              {savedViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => onApplyLens(view)}
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent-ring)] hover:text-[var(--text)]"
                >
                  {view.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
