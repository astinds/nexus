'use client';

import { useRef, useState } from 'react';
import { CloseIcon, UploadIcon } from '@/components/icons';
import { ingestFile, ingestText, ingestUrl } from '@/lib/api';
import { fileSize, formatLabel } from '@/lib/format';
import type { IngestResult, SourceFormat } from '@/lib/types';

export type Runner = (task: () => Promise<IngestResult>) => Promise<void>;

export const MAX_UPLOAD_MB = 25;

const ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv,.json';

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]';

const submitClass =
  'btn-primary w-full rounded-lg px-3 py-2.5 text-sm font-medium';

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
  const inputRef = useRef<HTMLInputElement>(null);

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
      {/* The browser's default file button is a tiny grey rectangle on a phone.
          This is the same <input type=file>, sized for a thumb. */}
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
          file
            ? 'border-[var(--accent-ring)] bg-[var(--accent-soft)]'
            : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent-ring)]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            setLocalError('');
            setFile(event.target.files?.[0] ?? null);
          }}
        />
        {file ? (
          <>
            <UploadIcon className="text-[var(--accent)]" />
            <span className="max-w-full truncate text-sm font-medium text-[var(--text)]">
              {file.name}
            </span>
            <span className="text-[11px] text-[var(--text-subtle)]">
              {fileSize(file.size)} · {formatLabel(formatForFile(file.name, knownFormats))} · tap to
              change
            </span>
          </>
        ) : (
          <>
            <UploadIcon className="text-[var(--text-subtle)]" />
            <span className="text-sm font-medium text-[var(--text)]">Choose a file</span>
            <span className="text-[11px] text-[var(--text-subtle)]">
              PDF, DOCX, Markdown, text, HTML, CSV or JSON · max {MAX_UPLOAD_MB} MB
            </span>
          </>
        )}
      </label>

      {file ? (
        <button
          type="button"
          onClick={() => {
            setFile(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
          className="btn-quiet flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs"
        >
          <CloseIcon />
          Clear selection
        </button>
      ) : null}

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
          <p className="text-[11px] text-[var(--text-subtle)]">
            Some sites block scraping. If the clip fails, paste the text instead.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => setPasteMode((value) => !value)}
        className="btn-quiet w-full rounded-lg px-3 py-2 text-xs"
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
