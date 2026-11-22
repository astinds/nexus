'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import BlueprintEditor from '@/components/studio/BlueprintEditor';
import PromptEditor from '@/components/studio/PromptEditor';
import {
  createRelationType,
  createWorkspace,
  deleteRelationType,
  deleteWorkspace,
  getRelationTypes,
  getWorkspaces,
  updateWorkspace,
} from '@/lib/api';
import type { RelationType, Workspace } from '@/lib/types';

type Tab = 'workspaces' | 'blueprints' | 'relations' | 'prompts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'blueprints', label: 'Blueprints' },
  { id: 'relations', label: 'Relation types' },
  { id: 'prompts', label: 'Prompt templates' },
];

const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

function WorkspacesPanel() {
  const [items, setItems] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    getWorkspaces()
      .then(setItems)
      .catch(() => setItems([]));
  };

  useEffect(load, []);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setMessage('');
    try {
      await task();
      setMessage(success);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New workspace"
          className={`${inputClass} flex-1`}
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await createWorkspace({ name: name.trim() });
              setName('');
            }, 'Workspace created.')
          }
          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-black disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <ul className="space-y-1">
        {items.map((workspace) => (
          <li
            key={workspace.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
          >
            <input
              defaultValue={workspace.name}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== workspace.name) {
                  void run(() => updateWorkspace(workspace.id, { name: next }), 'Renamed.');
                }
              }}
              aria-label={`Rename ${workspace.name}`}
              className={`${inputClass} w-40`}
            />
            <span className="text-[10px] opacity-40">{workspace.slug}</span>
            {workspace.is_default ? (
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] uppercase opacity-60">
                default
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  run(() => updateWorkspace(workspace.id, { is_default: true }), 'Default set.')
                }
                className="text-[10px] opacity-50 hover:opacity-100"
              >
                make default
              </button>
            )}
            {items.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete workspace "${workspace.name}" and its items?`)) return;
                  void run(() => deleteWorkspace(workspace.id), 'Workspace deleted.');
                }}
                className="ml-auto text-[10px] text-red-300 opacity-70 hover:opacity-100"
              >
                delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
    </div>
  );
}

function RelationsPanel() {
  const [items, setItems] = useState<RelationType[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    getRelationTypes()
      .then(setItems)
      .catch(() => setItems([]));
  };

  useEffect(load, []);

  const add = async () => {
    if (!name.trim()) return;
    setMessage('');
    try {
      await createRelationType({
        name: name.trim().toLowerCase().replace(/\s+/g, '_'),
        description: description.trim() || null,
      });
      setName('');
      setDescription('');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the relation type.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="relation_name"
          className={`${inputClass} w-40`}
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          className={`${inputClass} flex-1`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-black disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <ul className="space-y-1">
        {items.map((relation) => (
          <li
            key={relation.id}
            className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs"
          >
            <span className="font-mono">{relation.name}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] opacity-40">
              {relation.description ?? ''}
            </span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await deleteRelationType(relation.id);
                  load();
                } catch (err) {
                  setMessage(
                    err instanceof Error ? err.message : 'Only unused relation types can be deleted.'
                  );
                }
              }}
              className="text-[10px] text-red-300 opacity-70 hover:opacity-100"
            >
              delete
            </button>
          </li>
        ))}
      </ul>
      {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
    </div>
  );
}

export default function StudioPage() {
  const [tab, setTab] = useState<Tab>('blueprints');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="mb-1 text-lg font-semibold tracking-tight">Studio</h1>
          <p className="text-xs opacity-50">
            Workspaces, conceptual blueprints, relation types and prompt templates.
          </p>
        </div>

        <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-[var(--surface)] p-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-md px-2.5 py-1.5 text-[11px] ${
                tab === entry.id ? 'bg-[var(--accent)] font-medium text-black' : 'opacity-70'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          {tab === 'workspaces' ? <WorkspacesPanel /> : null}
          {tab === 'blueprints' ? (
            <BlueprintEditor key={refreshKey} onChanged={() => setRefreshKey((value) => value + 1)} />
          ) : null}
          {tab === 'relations' ? <RelationsPanel /> : null}
          {tab === 'prompts' ? <PromptEditor /> : null}
        </div>
      </div>
    </Shell>
  );
}
