'use client';

import { useEffect, useMemo, useState } from 'react';
import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import { getItems, getCollections, getTags, getBlueprints, getSavedViews, createSavedView } from '@/lib/api';
import { Item, Collection, Tag, Blueprint, SavedView, SourceFormat, TriageStatus, TimeBudget } from '@/lib/types';

type Layout = 'table' | 'cards';

const SOURCE_FORMATS: SourceFormat[] = [
  'pdf', 'docx', 'markdown', 'text', 'csv', 'json', 'web_article', 'note',
];

const TRIAGE_STATUSES: TriageStatus[] = [
  'inbox', 'reading', 'processed', 'evergreen', 'cold_archive',
];

const TIME_BUDGETS: { value: TimeBudget; label: string }[] = [
  { value: 'quick', label: '<5 min' },
  { value: 'medium', label: '15–30 min' },
  { value: 'deep', label: 'Deep Study' },
];

const PAGE_SIZE = 20;

export default function LibraryPage() {
  const [layout, setLayout] = useState<Layout>('cards');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [lenses, setLenses] = useState<SavedView[]>([]);

  // filters
  const [sourceFormat, setSourceFormat] = useState<SourceFormat | ''>('');
  const [blueprintId, setBlueprintId] = useState<string>('');
  const [triageStatus, setTriageStatus] = useState<TriageStatus | ''>('');
  const [timeBudget, setTimeBudget] = useState<TimeBudget | ''>('');
  const [collectionId, setCollectionId] = useState<string>('');
  const [tag, setTag] = useState<string>('');

  // option sources
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);

  useEffect(() => {
    void Promise.all([getCollections(), getTags(), getBlueprints(), getSavedViews()])
      .then(([cols, tgs, bps, views]) => {
        setCollections(cols);
        setTags(tgs);
        setBlueprints(bps);
        setLenses(views);
      })
      .catch(() => {
        // non-fatal
      });
  }, []);

  const fetchItems = () => {
    setLoading(true);
    getItems({
      source_format: sourceFormat || null,
      blueprint_id: blueprintId || null,
      triage_status: triageStatus || null,
      time_budget: timeBudget || null,
      collection_id: collectionId || null,
      tag: tag || null,
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
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, sourceFormat, blueprintId, triageStatus, timeBudget, collectionId, tag]);

  const saveLens = async () => {
    try {
      await createSavedView({
        name: `Library lens (${new Date().toLocaleTimeString()})`,
        kind: 'library',
        config: { source_format: sourceFormat, blueprint_id: blueprintId, triage_status: triageStatus, time_budget: timeBudget, collection_id: collectionId, tag },
        is_pinned: false,
      });
      const views = await getSavedViews();
      setLenses(views);
    } catch {
      // ignore
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          <button
            onClick={() => setCaptureOpen(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black"
          >
            + Capture
          </button>
        </div>

        {/* layout toggle */}
        <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
          <button
            onClick={() => setLayout('cards')}
            className={`px-3 py-1.5 text-xs ${layout === 'cards' ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface)] opacity-70 hover:opacity-100'}`}
          >
            Cards
          </button>
          <button
            onClick={() => setLayout('table')}
            className={`px-3 py-1.5 text-xs ${layout === 'table' ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface)] opacity-70 hover:opacity-100'}`}
          >
            Table
          </button>
        </div>

        {/* filters */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <select
            value={sourceFormat}
            onChange={(e) => {
              setSourceFormat((e.target.value as SourceFormat) || '');
              setOffset(0);
            }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">All formats</option>
            {SOURCE_FORMATS.map((f) => (
              <option key={f} value={f}>{f.replace('_', ' ')}</option>
            ))}
          </select>

          <select
            value={blueprintId}
            onChange={(e) => { setBlueprintId(e.target.value); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">All blueprints</option>
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <select
            value={triageStatus}
            onChange={(e) => { setTriageStatus((e.target.value as TriageStatus) || ''); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Any status</option>
            {TRIAGE_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>

          <select
            value={timeBudget}
            onChange={(e) => { setTimeBudget((e.target.value as TimeBudget) || ''); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Any length</option>
            {TIME_BUDGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <select
            value={collectionId}
            onChange={(e) => { setCollectionId(e.target.value); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <input
            type="text"
            value={tag}
            onChange={(e) => { setTag(e.target.value); setOffset(0); }}
            placeholder="Tag"
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <button
          onClick={saveLens}
          className="text-xs opacity-60 underline underline-offset-2 hover:opacity-100"
        >
          Save as Smart Lens
        </button>

        {/* results */}
        {loading ? (
          <p className="py-8 text-center text-sm opacity-60">Loading library…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm opacity-60">No items match these filters.</p>
        ) : layout === 'cards' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <a
                key={item.id}
                href={`/items/${item.id}`}
                className="rounded-xl border border-white/10 bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]/60"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase opacity-70">
                    {item.source_format}
                  </span>
                  <span className="text-[10px] uppercase opacity-50">{item.est_read_minutes} min</span>
                </div>
                <h3 className="truncate text-sm font-medium">{item.title || <span className="opacity-50">Untitled</span>}</h3>
                {item.blueprint_name ? <p className="mt-1 text-xs opacity-60">{item.blueprint_name}</p> : null}
              </a>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-[var(--surface)] text-xs opacity-60">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Format</th>
                  <th className="px-3 py-2 font-medium">Triage</th>
                  <th className="px-3 py-2 font-medium">Read</th>
                  <th className="px-3 py-2 font-medium">Blueprint</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="max-w-[240px] truncate px-3 py-2">
                      <a href={`/items/${item.id}`}>{item.title || 'Untitled'}</a>
                    </td>
                    <td className="px-3 py-2 text-xs opacity-70">{item.source_format}</td>
                    <td className="px-3 py-2 text-xs opacity-70">{item.triage_status}</td>
                    <td className="px-3 py-2 text-xs opacity-70">{item.est_read_minutes} min</td>
                    <td className="px-3 py-2 text-xs opacity-70">{item.blueprint_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* pagination */}
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-sm">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs opacity-60">
              Page {currentPage} of {totalPages} · {total} items
            </span>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}

        <p className="text-[10px] opacity-40">{lenses.length} saved lens{lenses.length === 1 ? '' : 'es'}</p>
      </div>

      {captureOpen ? <OmniCaptureModal onClose={() => setCaptureOpen(false)} /> : null}
    </Shell>
  );
}
