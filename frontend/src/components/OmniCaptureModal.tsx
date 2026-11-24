'use client';

import { useEffect, useState } from 'react';
import { ApiError, getIngestFormats } from '@/lib/api';
import { CloseIcon } from '@/components/icons';
import {
  FileTab,
  NoteTab,
  UrlTab,
  type Runner,
} from '@/components/capture/CaptureTabs';
import { plural } from '@/lib/format';
import { notifyDataChanged } from '@/lib/sync';
import type { IngestResult } from '@/lib/types';

type Tab = 'file' | 'url' | 'note';

const TABS: { id: Tab; label: string }[] = [
  { id: 'file', label: 'Upload file' },
  { id: 'url', label: 'Clip URL' },
  { id: 'note', label: 'Markdown note' },
];

/**
 * Omni-Capture: three ways in, one IngestService behind them.
 *
 * Deduplication and extraction warnings from the backend are surfaced verbatim
 * — a duplicate is information, not an error, and a scanned PDF must say so.
 */
export default function OmniCaptureModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('note');
  const [knownFormats, setKnownFormats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResult | null>(null);

  useEffect(() => {
    getIngestFormats()
      .then((res) => setKnownFormats(res.formats))
      .catch(() => setKnownFormats([]));
  }, []);

  const run: Runner = async (task) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const saved = await task();
      setResult(saved);
      // Dashboard counters and the Library list behind this sheet re-fetch now,
      // not on the next manual reload.
      notifyDataChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Capture"
        className="sheet-safe max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] px-5 pb-4 pt-2.5 sm:max-w-lg sm:rounded-xl sm:p-5"
      >
        {/* Drag affordance: the sheet is anchored to the bottom edge on phones. */}
        <div className="mb-2 flex justify-center sm:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-[var(--border)]" />
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Capture</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-2 text-[var(--text-subtle)] hover:text-[var(--text)]"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div role="tablist" className="mb-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => {
                setTab(entry.id);
                setError('');
                setResult(null);
              }}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                tab === entry.id
                  ? 'bg-[var(--surface)] font-medium text-[var(--text)]'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'file' ? (
          <FileTab busy={busy} knownFormats={knownFormats} onRun={run} />
        ) : null}
        {tab === 'url' ? <UrlTab busy={busy} onRun={run} /> : null}
        {tab === 'note' ? <NoteTab busy={busy} onRun={run} /> : null}

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : null}

        {result ? <CaptureResult result={result} /> : null}
      </div>
    </div>
  );
}

function CaptureResult({ result }: { result: IngestResult }) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
      <p>
        Saved <span className="font-medium">{result.item.title}</span>
        {result.segments_created > 0 ? ` · ${plural(result.segments_created, 'segment')}` : ''}
        {result.engine ? ` · ${result.engine}` : ''}
      </p>
      {result.duplicate ? (
        <p className="text-amber-300">
          Identical content already exists — this is a duplicate capture.
        </p>
      ) : null}
      {result.integrity?.partial ? (
        <p className="text-amber-300">
          Partial extraction: {result.integrity.scanned} scanned, {result.integrity.failed} failed
          of {result.integrity.segments} segments.
        </p>
      ) : null}
      {result.warnings.map((warning) => (
        <p key={warning} className="text-amber-300">
          {warning}
        </p>
      ))}
      <a
        href={`/items/${result.item.id}`}
        className="inline-block text-[var(--text)] underline underline-offset-2"
      >
        Open item
      </a>
    </div>
  );
}
