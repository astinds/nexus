'use client';

import { useEffect, useState } from 'react';
import { createLink, deleteLink, getItems } from '@/lib/api';
import type { Item, ItemDetail, RelationType } from '@/lib/types';

/**
 * Typed links between items.
 *
 * `relation_types` is seeded with 7 relations (relates_to, supports, contradicts…)
 * and is user-extendable in Studio. A link is directional, so the panel shows the
 * forward phrase from this item and names the target explicitly.
 */
export default function LinkPanel({
  item,
  relationTypes,
  onChanged,
}: {
  item: ItemDetail;
  relationTypes: RelationType[];
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Item[]>([]);
  const [targetId, setTargetId] = useState('');
  const [relationId, setRelationId] = useState(relationTypes[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!relationId && relationTypes[0]) setRelationId(relationTypes[0].id);
  }, [relationId, relationTypes]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getItems({ q: text, limit: 6 })
        .then((page) => {
          if (!cancelled) {
            setCandidates(page.items.filter((entry) => entry.id !== item.id));
          }
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, item.id]);

  const add = async () => {
    if (!targetId || !relationId) return;
    setMessage('');
    try {
      await createLink(item.id, {
        target_item_id: targetId,
        relation_type_id: relationId,
        note: note.trim() || null,
      });
      setQuery('');
      setTargetId('');
      setNote('');
      setMessage('Link added.');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the link.');
    }
  };

  const remove = async (linkId: string) => {
    try {
      await deleteLink(item.id, linkId);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove the link.');
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-wider opacity-50">Linked items</h3>

      {item.links.length === 0 ? (
        <p className="text-[11px] opacity-40">No links yet.</p>
      ) : (
        <ul className="space-y-1">
          {item.links.map((link) => (
            <li
              key={link.id}
              className="flex items-start justify-between gap-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-[11px]"
            >
              <span className="min-w-0">
                <span className="opacity-50">{link.relation_name ?? 'relates to'}</span>{' '}
                <a href={`/items/${link.target_item_id}`} className="underline underline-offset-2">
                  {link.target_item_id.slice(0, 8)}
                </a>
                {link.note ? <span className="block opacity-50">{link.note}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => remove(link.id)}
                aria-label="Remove link"
                className="shrink-0 opacity-50 hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find an item by title…"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
      />

      {candidates.length > 0 ? (
        <ul className="space-y-1">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => {
                  setTargetId(candidate.id);
                  setQuery(candidate.title);
                  setCandidates([]);
                }}
                className={`w-full truncate rounded px-2 py-1 text-left text-[11px] ${
                  targetId === candidate.id
                    ? 'bg-[var(--accent)] text-black'
                    : 'bg-[var(--surface-2)] opacity-70 hover:opacity-100'
                }`}
              >
                {candidate.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label="Relation type"
          value={relationId}
          onChange={(event) => setRelationId(event.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        >
          {relationTypes.map((relation) => (
            <option key={relation.id} value={relation.id}>
              {relation.name.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
      </div>

      <button
        type="button"
        onClick={add}
        disabled={!targetId || !relationId}
        className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-xs disabled:opacity-40"
      >
        Link selected item
      </button>
      {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
    </section>
  );
}
