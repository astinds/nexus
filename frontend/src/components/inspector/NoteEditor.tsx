'use client';

/**
 * Inline note editor with Write | Preview and a sticky action bar.
 *
 * The textarea is full-height because a note is written, not filled in, and the
 * preview uses the same Markdown renderer as the reader so what you see is what
 * the note will look like in the library.
 */

import { useState } from 'react';
import MarkdownView from '@/components/MarkdownView';
import { replaceNoteContent } from '@/lib/api';
import type { ItemDetail } from '@/lib/types';

export default function NoteEditor({
  item,
  onSaved,
}: {
  item: ItemDetail;
  onSaved: (updated: ItemDetail) => void;
}) {
  const initial = item.segments?.map((segment) => segment.content).join('\n\n') ?? '';
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = () => {
    setDraft(item.segments?.map((segment) => segment.content).join('\n\n') ?? '');
    setMode('write');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await replaceNoteContent(item.id, draft);
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this note.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="opacity-50">Markdown</span>
          <button
            type="button"
            onClick={start}
            className="rounded-md border border-[var(--border)] px-2 py-1 opacity-80 hover:opacity-100"
          >
            Edit
          </button>
        </div>
        <MarkdownView source={initial} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-xs">
        <div className="flex gap-1">
          {(['write', 'preview'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              className={`rounded-full px-3 py-1 capitalize ${
                mode === option ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface-2)]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <span className="opacity-50">Re-indexes on save</span>
      </div>

      <div className="flex-1 py-2">
        {mode === 'write' ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck
            className="h-full min-h-[55vh] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <MarkdownView source={draft} />
          </div>
        )}
      </div>

      {error ? <p className="text-xs text-amber-300">{error}</p> : null}

      <div className="sticky bottom-0 flex gap-2 border-t border-[var(--border)] bg-[var(--background)] py-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save and re-index'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
