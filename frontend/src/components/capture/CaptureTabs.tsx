'use client';

import { useState } from 'react';
import { ingestFile, ingestText, ingestUrl } from '@/lib/api';
import type { IngestResult, SourceFormat } from '@/lib/types';

export type Runner = (task: () => Promise<IngestResult>) => Promise<void>;

export const MAX_UPLOAD_MB = 25;

const ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv,.json';

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';

const submitClass =
  'w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black disabled:opacity-40';

export function formatForFile(name: string, known: string[]): SourceFormat {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, SourceFormat> = {
    pdf: 'pdf',
    docx: 'docx',
    md: 'markdown',
    markdown: 'markdown',
    txt: 'text',
    html: 'text',
    htm: 'text',
    csv: 'csv',
    json: 'json',
  };
  const guessed = map[ext];
  return guessed && (known.length === 0 || known.includes(guessed)) ? guessed : 'text';
}

export function FileTab({
  busy,
  knownFormats,
  onRun,
}: {
  busy: boolean;
  knownFormats: string[];
  onRun: Runner;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setLocalError(`Files must be ${MAX_UPLOAD_MB} MB or smaller.`);
      return;
    }
    setLocalError('');
    void onRun(() => ingestFile(file, formatForFile(file.name, knownFormats)));
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="file"
        accept={ACCEPT}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-[var(--accent)] file:px-2 file:py-1 file:text-black"
      />
      <p className="text-[11px] opacity-50">
        PDF, DOCX, Markdown, text, HTML, CSV or JSON · max {MAX_UPLOAD_MB} MB
      </p>
      {localError ? <p className="text-xs text-amber-300">{localError}</p> : null}
      <button type="submit" disabled={!file || busy} className={submitClass}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

export function UrlTab({ busy, onRun }: { busy: boolean; onRun: Runner }) {
  const [url, setUrl] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pasteMode) {
      if (!pasted.trim()) return;
      void onRun(() =>
        ingestText({
          text: pasted,
          source_format: 'web_article',
          paste_fallback: true,
        })
      );
      return;
    }
    if (!url.trim()) return;
    void onRun(() => ingestUrl({ url: url.trim() }));
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {pasteMode ? (
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={6}
          placeholder="Paste the article text or transcript here…"
          className={inputClass}
        />
      ) : (
        <>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
            className={inputClass}
          />
          <p className="text-[11px] opacity-50">
            Some sites block scraping. If the clip fails, paste the text instead.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => setPasteMode((value) => !value)}
        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs opacity-80 hover:opacity-100"
      >
        {pasteMode ? 'Use a URL instead' : 'Paste article / transcript'}
      </button>
      <button
        type="submit"
        disabled={busy || (pasteMode ? !pasted.trim() : !url.trim())}
        className={submitClass}
      >
        {busy ? 'Capturing…' : pasteMode ? 'Save pasted article' : 'Clip URL'}
      </button>
    </form>
  );
}

export function NoteTab({ busy, onRun }: { busy: boolean; onRun: Runner }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim() && !title.trim()) return;
    void onRun(() =>
      ingestText({
        text: body || title,
        title: title || null,
        source_format: 'note',
      })
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title (optional)"
        className={inputClass}
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={6}
        placeholder="Write in Markdown…"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={busy || (!body.trim() && !title.trim())}
        className={submitClass}
      >
        {busy ? 'Saving…' : 'Create note'}
      </button>
    </form>
  );
}
