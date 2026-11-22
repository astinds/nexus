'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Shell from '@/components/Shell';
import HighlightedSnippet from '@/components/HighlightedSnippet';
import { getTags, search } from '@/lib/api';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  SOURCE_FORMATS,
  TRIAGE_STATUSES,
  type SearchResponse,
  type SourceFormat,
  type Tag,
  type TriageStatus,
} from '@/lib/types';

const PAGE_SIZE = 20;

const selectClass =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]';

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [tags, setTags] = useState<Tag[]>([]);

  const [sourceFormat, setSourceFormat] = useState<SourceFormat | ''>('');
  const [triageStatus, setTriageStatus] = useState<TriageStatus | ''>('');
  const [tag, setTag] = useState('');

  useEffect(() => {
    getTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  // Shell's ⌘K lands here with ?focus=1.
  useEffect(() => {
    if (params.get('focus') === '1') inputRef.current?.focus();
  }, [params]);

  const run = (text: string, nextOffset: number) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    setLoading(true);
    setError('');
    search({
      q: trimmed,
      source_format: sourceFormat || undefined,
      triage_status: triageStatus || undefined,
      tag: tag || undefined,
      limit: PAGE_SIZE,
      offset: nextOffset,
    })
      .then((res) => {
        setResults(res);
        setOffset(nextOffset);
        router.replace(`/search?q=${encodeURIComponent(trimmed)}`, { scroll: false });
      })
      .catch((err: unknown) => {
        setResults(null);
        setError(err instanceof Error ? err.message : 'Search failed.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const initial = params.get('q');
    if (initial) run(initial, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Shell>
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Search</h1>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            run(query, 0);
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, pages and segments…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-black disabled:opacity-40"
          >
            {loading ? '…' : 'Search'}
          </button>
        </form>

        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="Format"
            className={selectClass}
            value={sourceFormat}
            onChange={(event) => setSourceFormat(event.target.value as SourceFormat | '')}
          >
            <option value="">All formats</option>
            {SOURCE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            aria-label="Triage status"
            className={selectClass}
            value={triageStatus}
            onChange={(event) => setTriageStatus(event.target.value as TriageStatus | '')}
          >
            <option value="">Any status</option>
            {TRIAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            aria-label="Tag"
            className={selectClass}
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="">Any tag</option>
            {tags.map((entry) => (
              <option key={entry.id} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}

        {results ? (
          <>
            <p className="text-[11px] opacity-50">
              {results.total} result{results.total === 1 ? '' : 's'} for “{results.query}”
              {results.mode === 'fallback' ? ' · fallback matching' : ''}
            </p>

            {results.hits.length === 0 ? (
              <p className="py-10 text-center text-sm opacity-50">No matches.</p>
            ) : (
              <ul className="space-y-2">
                {results.hits.map((hit) => (
                  <li key={`${hit.item_id}-${hit.segment_id ?? 'item'}`}>
                    <Link
                      href={`/items/${hit.item_id}${
                        hit.segment_index ? `?segment=${hit.segment_index}` : ''
                      }`}
                      className="block rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent)]/60"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{hit.title}</span>
                        <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase opacity-60">
                          {hit.source_format}
                        </span>
                      </div>
                      {hit.segment_label ? (
                        <span className="mb-1 inline-block rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] opacity-60">
                          {hit.segment_label}
                        </span>
                      ) : null}
                      <HighlightedSnippet snippet={hit.snippet} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {results.total > PAGE_SIZE ? (
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => run(query, Math.max(0, offset - PAGE_SIZE))}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="opacity-50">
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => run(query, offset + PAGE_SIZE)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : !loading ? (
          <p className="py-10 text-center text-sm opacity-50">
            Type a query to find exact pages and segments.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={<p className="px-6 py-16 text-center text-sm opacity-50">Preparing search…</p>}
    >
      <SearchView />
    </Suspense>
  );
}
