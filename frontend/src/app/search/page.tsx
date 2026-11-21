'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { search, getTags } from '@/lib/api';
import { SearchResponse, SourceFormat, TriageStatus, Tag } from '@/lib/types';

const PAGE_SIZE = 20;

const TRIAGE_STATUSES: TriageStatus[] = ['inbox', 'reading', 'processed', 'evergreen', 'cold_archive'];

export default function SearchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get('q') || '';

  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);

  const [sourceFormat, setSourceFormat] = useState<SourceFormat | ''>('');
  const [triageStatus, setTriageStatus] = useState<TriageStatus | ''>('');
  const [tag, setTag] = useState('');

  useEffect(() => {
    void getTags().then(setTags).catch(() => setTags([]));
  }, []);

  const runSearch = (newOffset: number) => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    search(q.trim(), {
      source_format: sourceFormat || undefined,
      triage_status: triageStatus || undefined,
      tag: tag || undefined,
      limit: PAGE_SIZE,
      offset: newOffset,
    })
      .then((res) => {
        setResults(res);
        setOffset(newOffset);
        router.replace(`/search?q=${encodeURIComponent(q.trim())}`, { scroll: false });
      })
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (initialQ) runSearch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    runSearch(0);
  };

  const totalPages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across segments, titles and content…"
            className="w-full rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {loading ? '…' : 'Search'}
          </button>
        </form>

        {/* facet filters */}
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={sourceFormat}
            onChange={(e) => { setSourceFormat(e.target.value as SourceFormat | ''); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">All formats</option>
            {['pdf', 'docx', 'markdown', 'text', 'csv', 'json', 'web_article', 'note'].map((f) => (
              <option key={f} value={f}>{f.replace('_', ' ')}</option>
            ))}
          </select>

          <select
            value={triageStatus}
            onChange={(e) => { setTriageStatus(e.target.value as TriageStatus | ''); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Any status</option>
            {TRIAGE_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>

          <select
            value={tag}
            onChange={(e) => { setTag(e.target.value); setOffset(0); }}
            className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* results */}
        {results ? (
          <div className="space-y-3">
            <p className="text-xs opacity-60">
              {results.total} result{results.total === 1 ? '' : 's'} for “{results.query}”
              {results.mode === 'fallback' ? ' · fallback mode' : ''}
            </p>

            {results.hits.length === 0 ? (
              <p className="py-8 text-center text-sm opacity-60">No matches.</p>
            ) : (
              <ul className="space-y-3">
                {results.hits.map((hit) => (
                  <li key={`${hit.item_id}-${hit.segment_id ?? 'item'}`}>
                    <a
                      href={`/items/${hit.item_id}`}
                      className="block rounded-xl border border-white/10 bg-[var(--surface)] p-4 hover:border-[var(--accent)]/60"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <h3 className="truncate text-sm font-medium">
                          {hit.title || <span className="opacity-50">Untitled</span>}
                        </h3>
                        <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase opacity-70">
                          {hit.source_format}
                        </span>
                      </div>
                      {hit.segment_label ? (
                        <span className="mb-1 inline-block rounded bg-white/5 px-1.5 py-0.5 text-[10px] opacity-60">
                          {hit.segment_label}
                        </span>
                      ) : null}
                      {/* ts_headline snippet - already HTML-highlighted by backend; render safe */}
                      <p
                        className="text-sm leading-relaxed opacity-80 [&_b]:text-[var(--accent)] [&_b]:font-semibold"
                        dangerouslySetInnerHTML={{ __html: hit.snippet }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {results.total > PAGE_SIZE ? (
              <div className="flex items-center justify-between text-sm">
                <button
                  disabled={offset === 0}
                  onClick={() => runSearch(Math.max(0, offset - PAGE_SIZE))}
                  className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs opacity-60">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => runSearch(offset + PAGE_SIZE)}
                  className="rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        ) : !loading ? (
          <p className="py-8 text-center text-sm opacity-60">
            Type a query and press Search to find exact pages and segments.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
