'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import TagManager from '@/components/collections/TagManager';
import {
  createCollection,
  deleteCollection,
  getCollectionTree,
  getWorkspaces,
  updateCollection,
} from '@/lib/api';
import { PARA_TYPES, type CollectionNode, type ParaType } from '@/lib/types';

const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

const PARA_LABEL: Record<ParaType, string> = {
  project: 'Project',
  area: 'Area',
  resource: 'Resource',
  archive: 'Archive',
};

function TreeNode({
  node,
  depth,
  onChanged,
}: {
  node: CollectionNode;
  depth: number;
  onChanged: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [para, setPara] = useState(node.para_type ?? '');

  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
        style={{ marginLeft: depth * 14 }}
      >
        {node.para_type ? (
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] uppercase opacity-60">
            {PARA_LABEL[node.para_type as ParaType] ?? node.para_type}
          </span>
        ) : null}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== node.name) {
              void updateCollection(node.id, { name: next }).then(onChanged);
            }
          }}
          aria-label={`Rename ${node.name}`}
          className={`${inputClass} w-40`}
        />
        <select
          aria-label={`PARA type for ${node.name}`}
          value={para}
          onChange={(event) => {
            const next = event.target.value as ParaType | '';
            setPara(next);
            void updateCollection(node.id, { para_type: next || null }).then(onChanged);
          }}
          className={inputClass}
        >
          <option value="">no PARA</option>
          {PARA_TYPES.map((type) => (
            <option key={type} value={type}>
              {PARA_LABEL[type]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Delete collection "${node.name}"? Items stay in the library.`)) {
              return;
            }
            void deleteCollection(node.id).then(onChanged);
          }}
          className="text-[10px] text-red-300 opacity-70 hover:opacity-100"
        >
          delete
        </button>
      </div>
      {node.children.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function CollectionsPage() {
  const [tree, setTree] = useState<CollectionNode[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [para, setPara] = useState<ParaType | ''>('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    getCollectionTree()
      .then(setTree)
      .catch(() => setTree([]));
  }, []);

  useEffect(() => {
    load();
    getWorkspaces()
      .then((list) => {
        const fallback = list.find((entry) => entry.is_default) ?? list[0];
        if (fallback) setWorkspaceId(fallback.id);
      })
      .catch(() => setWorkspaceId(''));
  }, [load]);

  const flat = (nodes: CollectionNode[], depth = 0): { node: CollectionNode; depth: number }[] =>
    nodes.flatMap((node) => [
      { node, depth },
      ...flat(node.children, depth + 1),
    ]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !workspaceId) return;
    setMessage('');
    try {
      await createCollection({
        workspace_id: workspaceId,
        name: trimmed,
        para_type: para || null,
        parent_id: parentId || null,
      });
      setName('');
      setParentId('');
      setPara('');
      setMessage('Collection created.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the collection.');
    }
  };

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="mb-1 text-lg font-semibold tracking-tight">Collections</h1>
          <p className="text-xs opacity-50">
            Nested folders with optional PARA typing. Structure is organisational only — it never
            changes an item&apos;s format or blueprint.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New collection"
            className={`${inputClass} flex-1`}
          />
          <select
            aria-label="Parent collection"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            className={inputClass}
          >
            <option value="">Top level</option>
            {flat(tree).map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {'—'.repeat(depth)} {node.name}
              </option>
            ))}
          </select>
          <select
            aria-label="PARA type"
            value={para}
            onChange={(event) => setPara(event.target.value as ParaType | '')}
            className={inputClass}
          >
            <option value="">no PARA</option>
            {PARA_TYPES.map((type) => (
              <option key={type} value={type}>
                {PARA_LABEL[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !workspaceId}
            className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-black disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {message ? <p className="text-[11px] opacity-60">{message}</p> : null}

        {tree.length === 0 ? (
          <p className="text-xs opacity-40">No collections yet.</p>
        ) : (
          <ul className="space-y-1">
            {tree.map((node) => (
              <TreeNode key={node.id} node={node} depth={0} onChanged={load} />
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-[var(--border)] pt-5">
          <h2 className="text-sm font-semibold">Tags</h2>
          <TagManager onChanged={load} />
        </div>
      </div>
    </Shell>
  );
}
