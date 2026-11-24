'use client';

import { useState } from 'react';
import {
  deleteItem,
  exportItemUrl,
  renderPromptContext,
  setTriage,
  updateItem,
} from '@/lib/api';
import {
  EXPORT_FORMATS,
  TRIAGE_STATUSES,
  type Collection,
  type ItemDetail,
  type PromptTemplate,
  type Tag,
  type TriageStatus,
} from '@/lib/types';
import { notifyDataChanged } from '@/lib/sync';
import { triageLabel } from '@/lib/format';

const chip = 'rounded-md border border-[var(--border)] px-2 py-1 text-[11px]';

/**
 * Universal inspector panel: everything that changes an item without leaving
 * the reader. Each section writes immediately through the typed API client and
 * then asks the page to refetch, so the panel never holds stale state.
 */
export default function InspectorDrawer({
  item,
  collections,
  tags,
  prompts,
  onChanged,
  onDeleted,
}: {
  item: ItemDetail;
  collections: Collection[];
  tags: Tag[];
  prompts: PromptTemplate[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [collectionIds, setCollectionIds] = useState<string[]>(
    item.collections.map((entry) => entry.id)
  );
  const [tagText, setTagText] = useState(item.tags.map((entry) => entry.name).join(', '));
  const [message, setMessage] = useState('');
  const [promptId, setPromptId] = useState(prompts[0]?.id ?? '');
  const [promptText, setPromptText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const triage = async (status: TriageStatus) => {
    try {
      await setTriage(item.id, status);
      onChanged();
      // Dashboard counters and Library filters update without a reload.
      notifyDataChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change triage.');
    }
  };

  const saveMembership = async () => {
    setMessage('');
    try {
      await updateItem(item.id, {
        collection_ids: collectionIds,
        tags: tagText
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      });
      setMessage('Membership saved.');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save membership.');
    }
  };

  const copyPrompt = async () => {
    if (!promptId) return;
    try {
      const rendered = await renderPromptContext(item.id, promptId);
      setPromptText(rendered.text);
      await navigator.clipboard?.writeText(rendered.text).catch(() => undefined);
      setMessage('Prompt copied with item context.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not render the prompt.');
    }
  };

  const remove = async () => {
    try {
      await deleteItem(item.id);
      notifyDataChanged();
      onDeleted();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete this item.');
    }
  };

  return (
    <aside className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
          Triage
        </h3>
        <div className="flex flex-wrap gap-1">
          {TRIAGE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={item.triage_status === status}
              onClick={() => triage(status)}
              className={`${chip} ${
                item.triage_status === status
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {triageLabel(status)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider opacity-50">Collections</h3>
        {collections.length === 0 ? (
          <p className="text-[11px] opacity-40">No collections yet.</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {collections.map((collection) => (
              <label key={collection.id} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={collectionIds.includes(collection.id)}
                  onChange={(event) =>
                    setCollectionIds((prev) =>
                      event.target.checked
                        ? [...prev, collection.id]
                        : prev.filter((id) => id !== collection.id)
                    )
                  }
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="truncate">
                  {collection.para_type ? (
                    <span className="mr-1 opacity-40">{collection.para_type[0].toUpperCase()}</span>
                  ) : null}
                  {collection.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider opacity-50">Tags</h3>
        <input
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
          placeholder="comma, separated, tags"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 12).map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() =>
                  setTagText((prev) => {
                    const current = prev
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean);
                    return current.includes(tag.name) ? prev : [...current, tag.name].join(', ');
                  })
                }
                className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] opacity-60 hover:opacity-100"
              >
                +{tag.name}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={saveMembership}
          className="w-full rounded-md bg-[var(--accent)] px-2 py-1.5 text-xs font-medium text-black"
        >
          Save collections and tags
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-wider opacity-50">Prompt with context</h3>
        {prompts.length === 0 ? (
          <p className="text-[11px] opacity-40">No prompt templates yet.</p>
        ) : (
          <>
            <select
              aria-label="Prompt template"
              value={promptId}
              onChange={(event) => setPromptId(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            >
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={copyPrompt}
              className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-xs"
            >
              Copy prompt with item context
            </button>
            {promptText ? (
              <textarea
                readOnly
                value={promptText}
                rows={4}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[10px]"
              />
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] uppercase tracking-wider opacity-50">Export</h3>
        <div className="flex flex-wrap gap-1">
          {EXPORT_FORMATS.map((format) => (
            <a
              key={format.value}
              href={exportItemUrl(item.id, format.value)}
              className={`${chip} opacity-70 hover:opacity-100`}
            >
              {format.label}
            </a>
          ))}
        </div>
        {item.source_uri ? (
          <a
            href={`/api/v1/items/${item.id}/download`}
            target="_blank"
            rel="noreferrer"
            className="block text-[11px] underline underline-offset-2 opacity-60 hover:opacity-100"
          >
            Original file
          </a>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-[var(--border)] pt-3">
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-300">
              Delete “{item.title}” and its segments? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={remove}
                className="flex-1 rounded-md bg-red-500/80 px-2 py-1.5 text-xs font-medium text-black"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full rounded-md border border-red-500/40 px-2 py-1.5 text-xs text-red-300"
          >
            Delete item
          </button>
        )}
        {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
      </section>
    </aside>
  );
}
