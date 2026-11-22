'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { ingestText, ingestUrl } from '@/lib/api';
import type { IngestResult } from '@/lib/types';

/**
 * Web Share Target landing page.
 *
 * Android Chrome shares with GET /capture?title=…&text=…&url=…, so the fields
 * arrive in the query string and are pre-filled here for one-tap capture. The
 * user still chooses what the share becomes (note, or clip the URL).
 */
function CaptureForm() {
  const params = useSearchParams();

  const sharedUrl = params.get('url') ?? '';
  const sharedTitle = params.get('title') ?? '';
  const sharedText = params.get('text') ?? '';

  const [title, setTitle] = useState(sharedTitle);
  const [body, setBody] = useState(sharedText);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState('');

  // When the share carries only a URL, keep the URL visible as the note body.
  useEffect(() => {
    if (!sharedText && sharedUrl) setBody(sharedUrl);
  }, [sharedText, sharedUrl]);

  const saveNote = async () => {
    if (!body.trim() && !title.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await ingestText({
        text: body || title,
        title: title || null,
        source_format: 'note',
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this capture.');
    } finally {
      setBusy(false);
    }
  };

  const clipUrl = async () => {
    if (!sharedUrl) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await ingestUrl({ url: sharedUrl, title: title || null });
      setResult(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — paste the article text instead.`
          : 'Could not clip that URL.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Capture shared content</h1>
          <p className="text-xs opacity-50">
            Everything arrives in the Inbox with zero required fields — triage later.
          </p>
        </div>

        {sharedUrl ? (
          <p className="truncate rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] opacity-60">
            {sharedUrl}
          </p>
        ) : null}

        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title (optional)"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          placeholder="Shared text or Markdown…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveNote}
            disabled={busy || (!body.trim() && !title.trim())}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save as note'}
          </button>
          {sharedUrl ? (
            <button
              type="button"
              onClick={clipUrl}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-40"
            >
              Clip the URL as an article
            </button>
          ) : null}
          <Link
            href="/"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs opacity-70"
          >
            Cancel
          </Link>
        </div>

        {error ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
            <p>
              Saved <span className="font-medium">{result.item.title}</span>
              {result.segments_created ? ` · ${result.segments_created} segments` : ''}
            </p>
            {result.duplicate ? (
              <p className="text-amber-300">This content already existed — duplicate capture.</p>
            ) : null}
            {result.warnings.map((warning) => (
              <p key={warning} className="text-amber-300">
                {warning}
              </p>
            ))}
            <Link
              href={`/items/${result.item.id}`}
              className="inline-block underline underline-offset-2 opacity-80"
            >
              Open item
            </Link>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

export default function CapturePage() {
  return (
    <Suspense
      fallback={<p className="px-6 py-16 text-center text-sm opacity-50">Preparing capture…</p>}
    >
      <CaptureForm />
    </Suspense>
  );
}
