'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import FilterBar, { type LibraryFilterState } from '@/components/library/FilterBar';
import LibraryList from '@/components/library/LibraryList';
import {
  createSavedView,
  getBlueprints,
  getCollections,
  getItems,
  getSavedViews,
  getTags,
} from '@/lib/api';
import { plural } from '@/lib/format';
import { useLiveData } from '@/lib/sync';
import type { Blueprint, Collection, Item, SavedView, Tag } from '@/lib/types';

const PAGE_SIZE = 24;

const EMPTY: LibraryFilterState = {
  source_format: '',
  blueprint_id: '',
  triage_status: '',
  time_budget: '',
  collection_id: '',
  tag: '',
};

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <p className="px-6 py-16 text-center text-sm text-[var(--text-subtle)]">Loading library…</p>
      }
    >
      <LibraryView />
    </Suspense>
  );
}

function LibraryView() {
  const searchParams = useSearchParams();
  const lensId = searchParams.get('lens');

  const [filters, setFilters] = useState<LibraryFilterState>(EMPTY);
  const [layout, setLayout] = useState<'cards' | 'table'>('cards');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState(false);
  const [lensName, setLensName] = useState('');
  const [notice, setNotice] = useState('');

  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  useEffect(() => {
    Promise.all([getCollections(), getTags(), getBlueprints(), getSavedViews()])
      .then(([cols, tgs, bps, views]) => {
        setCollections(cols);
        setTags(tgs);
        setBlueprints(bps);
        setSavedViews(views);
      })
      .catch(() => setNotice('Catalog unavailable — filters limited.'));
  }, []);

  // A pinned Smart Lens opens the library with its saved filter set applied.
  useEffect(() => {
    if (!lensId) return;
    let cancelled = false;
    getSavedViews()
      .then((views) => {
        const lens = views.find((entry) => entry.id === lensId);
        if (cancelled || !lens) return;
        setFilters({ ...EMPTY, ...(lens.config as Partial<LibraryFilterState>) });
        setNotice(`Lens "${lens.name}" applied.`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lensId]);

  const load = useCallback(() => {
    setLoading(true);
    getItems({
      source_format: filters.source_format || null,
      blueprint_id: filters.blueprint_id || null,
      triage_status: filters.triage_status || null,
      time_budget: filters.time_budget || null,
      collection_id: filters.collection_id || null,
      tag: filters.tag || null,
      limit: PAGE_SIZE,
      offset,
      sort: 'recent',
    })
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [filters, offset]);

  useEffect(load, [load]);
  // A capture in the sheet behind this page, or a triage change elsewhere,
  // re-runs this query without a manual reload.
  useLiveData(load);

  const update = <K extends keyof LibraryFilterState>(
    key: K,
    value: LibraryFilterState[K]
  ) => {
    setOffset(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const saveLens = async () => {
    const name = lensName.trim();
    if (!name) return;
    try {
      const created = await createSavedView({ name, kind: 'library', config: { ...filters } });
      setLensName('');
      setSavedViews((prev) => [...prev, created]);
      setNotice(`Lens "${name}" saved.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save lens.');
    }
  };

  const applyLens = (lens: SavedView) => {
    setOffset(0);
    setFilters({ ...EMPTY, ...(lens.config as Partial<LibraryFilterState>) });
    setNotice(`Lens "${lens.name}" applied.`);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Shell>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Library</h1>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
              {(['cards', 'table'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={layout === mode}
                  onClick={() => setLayout(mode)}
                  className={`px-2.5 py-1.5 text-[11px] capitalize ${
                    layout === mode
                      ? 'bg-[var(--surface-2)] text-[var(--text)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            {/* Phone users have the centered + in the bottom bar. */}
            <button
              type="button"
              onClick={() => setCapture(true)}
              className="btn-primary hidden rounded-lg px-3 py-1.5 text-xs font-medium md:inline-block"
            >
              Capture
            </button>
          </div>
        </div>

        <FilterBar
          filters={filters}
          onChange={update}
          collections={collections}
          tags={tags}
          blueprints={blueprints}
          savedViews={savedViews}
          onApplyLens={applyLens}
          lensName={lensName}
          onLensName={setLensName}
          onSaveLens={saveLens}
          onReset={() => {
            setFilters(EMPTY);
            setOffset(0);
          }}
          notice={notice}
        />

        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--text-subtle)]">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--text-subtle)]">
            No items match these filters.
          </p>
        ) : (
          <LibraryList items={items} layout={layout} />
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              className="btn-quiet rounded-lg px-2.5 py-1.5"
            >
              Previous
            </button>
            <span className="text-[var(--text-subtle)]">
              {page} / {pages} · {plural(total, 'item')}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
              className="btn-quiet rounded-lg px-2.5 py-1.5"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {capture ? <OmniCaptureModal onClose={() => setCapture(false)} /> : null}
    </Shell>
  );
}
