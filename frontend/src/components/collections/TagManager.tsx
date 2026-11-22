'use client';

import { useEffect, useState } from 'react';
import { createTag, deleteTag, getTags, mergeTags, updateTag } from '@/lib/api';
import type { Tag } from '@/lib/types';

const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

/**
 * Tag manager: rename, edit aliases, merge duplicates, delete.
 *
 * Aliases exist so a search for "ml" also finds "machine-learning" without
 * duplicating items. Merging moves every item link from A to B, then deletes A.
 */
export default function TagManager({ onChanged }: { onChanged: () => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');

  const load = () => {
    getTags()
      .then(setTags)
      .catch(() => setTags([]));
  };

  useEffect(load, []);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setMessage('');
    try {
      await task();
      setMessage(success);
      load();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New tag"
          className={`${inputClass} flex-1`}
        />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() =>
            run(async () => {
              await createTag(newName.trim());
              setNewName('');
            }, 'Tag created.')
          }
          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-black disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {tags.length === 0 ? (
        <p className="text-xs opacity-40">No tags yet.</p>
      ) : (
        <ul className="space-y-1">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
            >
              <input
                defaultValue={tag.name}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== tag.name) {
                    void run(() => updateTag(tag.id, { name: next }), 'Tag renamed.');
                  }
                }}
                className={`${inputClass} w-32`}
                aria-label={`Rename ${tag.name}`}
              />
              <input
                defaultValue={tag.aliases.join(', ')}
                onBlur={(event) => {
                  const aliases = event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  if (aliases.join('|') !== tag.aliases.join('|')) {
                    void run(() => updateTag(tag.id, { aliases }), 'Aliases saved.');
                  }
                }}
                placeholder="aliases, comma separated"
                className={`${inputClass} flex-1`}
                aria-label={`Aliases for ${tag.name}`}
              />
              <span className="text-[10px] opacity-40">{tag.item_count} items</span>
              <button
                type="button"
                onClick={() => run(() => deleteTag(tag.id), 'Tag deleted.')}
                className="text-[10px] text-red-300 opacity-70 hover:opacity-100"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {tags.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2">
          <span className="text-[10px] uppercase opacity-50">Merge</span>
          <select
            aria-label="Merge source tag"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className={inputClass}
          >
            <option value="">from…</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <span className="text-xs opacity-40">→</span>
          <select
            aria-label="Merge target tag"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className={inputClass}
          >
            <option value="">into…</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!sourceId || !targetId || sourceId === targetId}
            onClick={() =>
              run(async () => {
                await mergeTags({ source_tag_id: sourceId, target_tag_id: targetId });
                setSourceId('');
                setTargetId('');
              }, 'Tags merged.')
            }
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
          >
            Merge
          </button>
        </div>
      ) : null}

      {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
    </section>
  );
}
