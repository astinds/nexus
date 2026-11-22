'use client';

import { useEffect, useState } from 'react';
import { createBlueprint, deleteBlueprint, getBlueprints, updateBlueprint } from '@/lib/api';
import {
  FIELD_TYPES,
  type Blueprint,
  type BlueprintFieldSpec,
  type FieldType,
} from '@/lib/types';

const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

const EMPTY_FIELD: BlueprintFieldSpec = {
  key: '',
  label: '',
  type: 'text',
  options: [],
  required: false,
  help: null,
};

/**
 * Visual editor for `metadata_blueprints.fields_schema`.
 *
 * Keys are normalised to lower_snake_case by the backend, and a `select` field
 * must carry at least one option — both rules are surfaced here so a save does
 * not fail with a bare 422.
 */
export default function BlueprintEditor({ onChanged }: { onChanged: () => void }) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selected, setSelected] = useState<Blueprint | null>(null);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<BlueprintFieldSpec[]>([]);
  const [message, setMessage] = useState('');

  const load = () => {
    getBlueprints()
      .then(setBlueprints)
      .catch(() => setBlueprints([]));
  };

  useEffect(load, []);

  const select = (blueprint: Blueprint) => {
    setSelected(blueprint);
    setName(blueprint.name);
    setFields(blueprint.fields_schema?.fields ?? []);
    setMessage('');
  };

  const patch = (index: number, next: Partial<BlueprintFieldSpec>) =>
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...next } : field)));

  const save = async () => {
    setMessage('');
    const invalid = fields.find(
      (field) => !field.key.trim() || !field.label.trim() || (field.type === 'select' && field.options.length === 0)
    );
    if (invalid) {
      setMessage(`Field "${invalid.key || invalid.label}" needs a key, a label${invalid.type === 'select' ? ' and at least one option' : ''}.`);
      return;
    }
    try {
      const payload = { name: name.trim(), fields_schema: { fields } };
      if (selected) {
        await updateBlueprint(selected.id, payload);
        setMessage('Blueprint updated.');
      } else {
        await createBlueprint(payload);
        setMessage('Blueprint created.');
      }
      setSelected(null);
      setName('');
      setFields([]);
      load();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save the blueprint.');
    }
  };

  const remove = async (blueprint: Blueprint) => {
    if (!window.confirm(`Delete blueprint "${blueprint.name}"? Items keep their content.`)) return;
    try {
      await deleteBlueprint(blueprint.id);
      if (selected?.id === blueprint.id) {
        setSelected(null);
        setName('');
        setFields([]);
      }
      load();
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete the blueprint.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {blueprints.map((blueprint) => (
          <button
            key={blueprint.id}
            type="button"
            onClick={() => select(blueprint)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              selected?.id === blueprint.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--border)] opacity-70 hover:opacity-100'
            }`}
          >
            {blueprint.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setName('');
            setFields([]);
            setMessage('');
          }}
          className="rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[11px] opacity-60 hover:opacity-100"
        >
          + New blueprint
        </button>
      </div>

      <div className="space-y-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Blueprint name (e.g. Research Paper)"
          className={`${inputClass} w-full`}
        />

        {fields.map((field, index) => (
          <div
            key={index}
            className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 sm:grid-cols-5"
          >
            <input
              value={field.key}
              onChange={(event) => patch(index, { key: event.target.value })}
              placeholder="key"
              className={inputClass}
            />
            <input
              value={field.label}
              onChange={(event) => patch(index, { label: event.target.value })}
              placeholder="label"
              className={inputClass}
            />
            <select
              value={field.type}
              onChange={(event) => patch(index, { type: event.target.value as FieldType })}
              className={inputClass}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              value={field.options.join(', ')}
              onChange={(event) =>
                patch(index, {
                  options: event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                })
              }
              placeholder={field.type === 'select' ? 'options, comma separated' : 'options'}
              disabled={field.type !== 'select'}
              className={`${inputClass} disabled:opacity-40`}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1 text-[10px] opacity-60">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => patch(index, { required: event.target.checked })}
                  className="h-3 w-3 accent-[var(--accent)]"
                />
                required
              </label>
              <button
                type="button"
                onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}
                className="text-[10px] text-red-300 opacity-70 hover:opacity-100"
              >
                remove
              </button>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFields((prev) => [...prev, { ...EMPTY_FIELD }])}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] opacity-80 hover:opacity-100"
          >
            + Field
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!name.trim()}
            className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-40"
          >
            {selected ? 'Save blueprint' : 'Create blueprint'}
          </button>
          {selected ? (
            <button
              type="button"
              onClick={() => remove(selected)}
              className="rounded-md border border-red-500/40 px-2 py-1 text-[11px] text-red-300"
            >
              Delete
            </button>
          ) : null}
        </div>

        {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
      </div>
    </div>
  );
}
