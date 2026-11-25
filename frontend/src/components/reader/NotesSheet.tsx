'use client';

/**
 * Notes & Highlights sheet, scoped to one item.
 *
 * The filter is "this page" vs "all pages" because those are the only two
 * questions a reader has mid-document. Adding a note captures the current page
 * automatically: nobody wants to type a page number they are already looking at.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createAnnotation,
  deleteAnnotation,
  listAnnotations,
} from '@/lib/api';
import type { Annotation } from '@/lib/types';

export default function NotesSheet({
  open,
  onClose,
  itemId,
  page,
  quote,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  page: number;
  quote?: string;
  onJump: (page: number) => void;
}) {
  const [filter, setFilter] = useState<'page' | 'all'>('page');
  const [all, setAll] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState('');
  const [quoteDraft, setQuoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setAll(await listAnnotations(itemId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notes.');
    }
  }, [itemId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (open && quote) setQuoteDraft(quote);
  }, [open, quote]);

  const shown =
    filter === 'page'
      ? all.filter((entry) => entry.segment_index === page || entry.segment_index === null)
      : all;

  const add = async () => {
    if (!draft.trim() && !quoteDraft.trim()) return;
    setBusy(true);
    try {
      await createAnnotation(itemId, {
        segment_index: page,
        segment_label: `Page ${page}`,
        quote_text: quoteDraft.trim() || null,
        note_body: draft.trim(),
      });
      setDraft('');
      setQuoteDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this note.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteAnnotation(itemId, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this note.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Notes and highlights">
      <button type="button" aria-label="Close notes" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--background)] sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Notes &amp; highlights</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
            Close
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3 text-[11px]">
          <button
            type="button"
            onClick={() => setFilter('page')}
            className={`rounded-full px-3 py-1 ${filter === 'page' ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface-2)]'}`}
          >
            This page
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-full px-3 py-1 ${filter === 'all' ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface-2)]'}`}
          >
            All pages ({all.length})
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {shown.length === 0 ? (
            <p className="text-xs opacity-50">
              {filter === 'page' ? `No notes on page ${page} yet.` : 'No notes yet.'}
            </p>
          ) : (
            shown.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between text-[11px] opacity-60">
                  <button
                    type="button"
                    onClick={() => entry.segment_index && onJump(entry.segment_index)}
                    className="underline underline-offset-2"
                  >
                    {entry.segment_label ?? 'Whole item'}
                  </button>
                  <button type="button" onClick={() => void remove(entry.id)} className="opacity-60 hover:opacity-100">
                    Delete
                  </button>
                </div>
                {entry.quote_text ? (
                  <blockquote className="mt-1 border-l-2 border-[var(--accent)] pl-2 text-[12px] italic opacity-80">
                    {entry.quote_text}
                  </blockquote>
                ) : null}
                {entry.note_body ? <p className="mt-1 text-[13px]">{entry.note_body}</p> : null}
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-[var(--border)] px-4 py-3">
          {quoteDraft ? (
            <div className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] italic opacity-80">
              “{quoteDraft.slice(0, 160)}”
              <button type="button" onClick={() => setQuoteDraft('')} className="ml-2 underline">
                clear
              </button>
            </div>
          ) : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder={`Add note for Page ${page}…`}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs"
          />
          {error ? <p className="text-[11px] text-amber-300">{error}</p> : null}
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || (!draft.trim() && !quoteDraft.trim())}
            className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy ? 'Saving…' : `+ Add note for Page ${page}`}
          </button>
        </div>
      </div>
    </div>
  );
}
