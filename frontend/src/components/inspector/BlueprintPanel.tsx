'use client';

import { useEffect, useState } from 'react';
import { updateItem } from '@/lib/api';
import type { Blueprint, BlueprintFieldSpec, ItemDetail } from '@/lib/types';

const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]';

/** One typed control per blueprint field spec (text/number/date/select/boolean/url). */
function Field({
  spec,
  value,
  onChange,
}: {
  spec: BlueprintFieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `field-${spec.key}`;
  const label = (
    <label htmlFor={id} className="mb-1 block text-[10px] uppercase opacity-50">
      {spec.label}
      {spec.required ? <span className="text-[var(--accent)]"> *</span> : null}
    </label>
  );

  if (spec.type === 'boolean') {
    return (
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-xs">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          {spec.label}
        </label>
      </div>
    );
  }

  if (spec.type === 'select') {
    return (
      <div>
        {label}
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value || null)}
          className={inputClass}
        >
          <option value="">—</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const inputType =
    spec.type === 'number' ? 'number' : spec.type === 'date' ? 'date' : spec.type === 'url' ? 'url' : 'text';

  return (
    <div>
      {label}
      <input
        id={id}
        type={inputType}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') return onChange(null);
          onChange(spec.type === 'number' ? Number(raw) : raw);
        }}
        className={inputClass}
      />
      {spec.help ? <p className="mt-0.5 text-[10px] opacity-40">{spec.help}</p> : null}
    </div>
  );
}

/**
 * Blueprint assignment + dynamic custom-field form.
 *
 * The field list comes from the blueprint's `fields_schema`, not from the item,
 * so switching blueprint re-renders the form immediately (ADR-002).
 */
export default function BlueprintPanel({
  item,
  blueprints,
  onChanged,
}: {
  item: ItemDetail;
  blueprints: Blueprint[];
  onChanged: () => void;
}) {
  const [blueprintId, setBlueprintId] = useState(item.blueprint_id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(item.custom_fields ?? {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setBlueprintId(item.blueprint_id ?? '');
    setValues(item.custom_fields ?? {});
  }, [item.id, item.blueprint_id, item.custom_fields]);

  const active = blueprints.find((entry) => entry.id === blueprintId);
  const specs = active?.fields_schema?.fields ?? [];

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await updateItem(item.id, {
        blueprint_id: blueprintId || null,
        custom_fields: values,
      });
      setMessage('Saved.');
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-wider opacity-50">Blueprint</h3>

      <select
        aria-label="Blueprint"
        value={blueprintId}
        onChange={(event) => setBlueprintId(event.target.value)}
        className={inputClass}
      >
        <option value="">No blueprint</option>
        {blueprints.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>

      {specs.map((spec) => (
        <Field
          key={spec.key}
          spec={spec}
          value={values[spec.key]}
          onChange={(value) => setValues((prev) => ({ ...prev, [spec.key]: value }))}
        />
      ))}

      {active && specs.length === 0 ? (
        <p className="text-[11px] opacity-40">This blueprint has no custom fields yet.</p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="w-full rounded-md bg-[var(--accent)] px-2 py-1.5 text-xs font-medium text-black disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save blueprint fields'}
      </button>
      {message ? <p className="text-[11px] opacity-60">{message}</p> : null}
    </section>
  );
}
