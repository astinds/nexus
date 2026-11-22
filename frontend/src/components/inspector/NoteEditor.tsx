'use client';

import { useState } from 'react';
import { replaceNoteContent } from '@/lib/api';
import type { ItemDetail } from '@/lib/types';

/**
 * Inline Markdown editor for notes.
 *
 * Saving goes through PUT /api/v1/items/{id}/content, which rewrites the note's
 * segments and re-indexes the tsvector in one transaction — so an edit is
 * immediately searchable. Only notes and Markdown items accept this.
 */
export default function NoteEditor({
  item,
  onSaved,
}: {
  item: ItemDetail;
  onSaved: (updated: ItemDetail) => void;
}) {
  const [draft, setDraft] = useState(item.segments?.[0]?.content ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const editable = item.source_format === 'note' || item.source_format === 'markdown';

  if (!editable) {
    return (
      <div className="prose-reading text-sm">
        {item.segments?.map((segment) => segment.content).join('\n\n') || (
          <span className="opacity-50">No content.</span>
        )}
      </div>
    );
  }

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="opacity-50">{editing ? 'Editing — re-indexes on save' : 'Markdown'}</span>
        <button
          type="button"
          onClick={() => {
            if (!editing) setDraft(item.segments?.[0]?.content ?? draft);
            setEditing((value) => !value);
          }}
          className="rounded-md border border-[var(--border)] px-2 py-1 opacity-80 hover:opacity-100"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={16}
            spellCheck
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
          />
          {error ? <p className="text-xs text-amber-300">{error}</p> : null}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-black disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save and re-index'}
          </button>
        </>
      ) : (
        <div className="prose-reading text-sm">
          {item.segments?.map((segment) => segment.content).join('\n\n') || (
            <span className="opacity-50">Empty note.</span>
          )}
        </div>
      )}
    </div>
  );
}
