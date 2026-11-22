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
import type { Blueprint, Collection, Item, Tag } from '@/lib/types';

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
      fallback={<p className="px-6 py-16 text-center text-sm opacity-50">Loading library…</p>}
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

  useEffect(() => {
    Promise.all([getCollections(), getTags(), getBlueprints()])
      .then(([cols, tgs, bps]) => {
        setCollections(cols);
        setTags(tgs);
        setBlueprints(bps);
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
      await createSavedView({ name, kind: 'library', config: { ...filters } });
      setLensName('');
      setNotice(`Lens "${name}" saved.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save lens.');
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Library</h1>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
              {(['cards', 'table'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayout(mode)}
                  className={`px-2.5 py-1.5 text-[11px] capitalize ${
                    layout === mode ? 'bg-[var(--accent)] text-black' : 'opacity-70'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCapture(true)}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-black"
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
          <p className="py-10 text-center text-sm opacity-50">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm opacity-50">No items match these filters.</p>
        ) : (
          <LibraryList items={items} layout={layout} />
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="opacity-50">
              {page} / {pages} · {total} items
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40"
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
