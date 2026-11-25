'use client';

/**
 * The Manage sheet: everything administrative, out of the reading column.
 *
 * Triage, collections, tags, prompts, export, blueprint fields, typed links,
 * download and delete all live here. The reader keeps only a page, a progress
 * line and a triage pill, which is the whole point of the overhaul: nothing
 * between the reader and the text.
 */

import { useEffect } from 'react';
import BlueprintPanel from './BlueprintPanel';
import InspectorDrawer from './InspectorDrawer';
import LinkPanel from './LinkPanel';
import type {
  Blueprint,
  Collection,
  ItemDetail,
  PromptTemplate,
  RelationType,
  Tag,
} from '@/lib/types';

export default function ManageSheet({
  open,
  onClose,
  item,
  collections,
  tags,
  prompts,
  blueprints,
  relationTypes,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  item: ItemDetail;
  collections: Collection[];
  tags: Tag[];
  prompts: PromptTemplate[];
  blueprints: Blueprint[];
  relationTypes: RelationType[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  // Escape closes; the sheet traps focus only by being the last thing in the DOM.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Manage item">
      <button
        type="button"
        aria-label="Close manage sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--background)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Manage</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
          <InspectorDrawer
            item={item}
            collections={collections}
            tags={tags}
            prompts={prompts}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
          <div className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <BlueprintPanel item={item} blueprints={blueprints} onChanged={onChanged} />
            <LinkPanel item={item} relationTypes={relationTypes} onChanged={onChanged} />
          </div>
          {item.source_uri ? (
            <a
              href={`/api/v1/items/${item.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-[var(--border)] px-3 py-2 text-center text-xs opacity-80 hover:opacity-100"
            >
              Open original file
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
