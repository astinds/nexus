'use client';

import { useEffect, useState } from 'react';
import {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplates,
  updatePromptTemplate,
} from '@/lib/api';
import type { PromptTemplate } from '@/lib/types';

const inputClass =
  'rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]';

/** Prompt templates are the "copy with context" library; no model is ever called. */
export default function PromptEditor() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    getPromptTemplates()
      .then(setPrompts)
      .catch(() => setPrompts([]));
  };

  useEffect(load, []);

  const select = (prompt: PromptTemplate) => {
    setSelected(prompt);
    setName(prompt.name);
    setBody(prompt.body);
    setDescription(prompt.description ?? '');
    setMessage('');
  };

  const reset = () => {
    setSelected(null);
    setName('');
    setBody('');
    setDescription('');
    setMessage('');
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) return;
    setMessage('');
    try {
      if (selected) {
        await updatePromptTemplate(selected.id, {
          name: name.trim(),
          body,
          description: description.trim() || null,
        });
        setMessage('Template updated.');
      } else {
        await createPromptTemplate({
          name: name.trim(),
          body,
          description: description.trim() || null,
        });
        setMessage('Template created.');
      }
      reset();
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save the template.');
    }
  };

  const remove = async (prompt: PromptTemplate) => {
    if (!window.confirm(`Delete template "${prompt.name}"?`)) return;
    try {
      await deletePromptTemplate(prompt.id);
      if (selected?.id === prompt.id) reset();
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete the template.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => select(prompt)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              selected?.id === prompt.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-[var(--border)] opacity-70 hover:opacity-100'
            }`}
          >
            {prompt.name}
          </button>
        ))}
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[11px] opacity-60 hover:opacity-100"
        >
          + New template
        </button>
      </div>

      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Template name"
        className={`${inputClass} w-full`}
      />
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Short description (optional)"
        className={`${inputClass} w-full`}
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={7}
        placeholder="Template body — the item header and excerpts are appended automatically."
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!name.trim() || !body.trim()}
          className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-40"
        >
          {selected ? 'Save template' : 'Create template'}
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
  );
}
