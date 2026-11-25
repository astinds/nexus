'use client';

import { useState } from 'react';
import type { SegmentIntegrity } from '@/lib/types';
import { plural } from '@/lib/format';

/**
 * Compact extraction honesty line.
 *
 * The old banner was a full amber card under every PDF, which made a normal scan
 * feel like a failure. A scanned cover or a blank back page is not an incident:
 * it is one muted line, `271/278 pages searchable · Details`, that only opens into
 * the per-page list when asked. Amber is reserved for pages that actually failed.
 */
export default function IntegrityPill({
  integrity,
  onJump,
}: {
  integrity: SegmentIntegrity | null;
  onJump?: (segmentIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!integrity) return null;

  const total = integrity.segments || 0;
  const searchable = integrity.extracted || 0;
  const missing = Math.max(0, total - searchable);
  const failed = integrity.failed || 0;
  const hasFailures = failed > 0;

  return (
    <div
      className={`rounded-full border px-3 py-1 text-[11px] ${
        hasFailures
          ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-subtle)]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular-nums">
          {searchable}/{total} pages searchable
        </span>
        {missing > 0 && !hasFailures ? (
          <span className="opacity-60">· {plural(missing, 'page')} without text</span>
        ) : null}
        {hasFailures ? (
          <span className="opacity-80">· {plural(failed, 'page')} failed</span>
        ) : null}
        {missing > 0 || hasFailures ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="underline underline-offset-2 opacity-70 hover:opacity-100"
          >
            {open ? 'Hide' : 'Details'}
          </button>
        ) : integrity.engine ? (
          <span className="opacity-50">· {integrity.engine}</span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-2 pb-1">
          {integrity.scanned_labels.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1">
              <span className="opacity-60">No text:</span>
              {integrity.scanned_labels.slice(0, 24).map((label, index) => {
                const digits = label.match(/\d+/);
                const target = digits ? Number(digits[0]) : index + 1;
                return (
                  <button
                    key={`${label}-${index}`}
                    type="button"
                    onClick={() => onJump?.(target)}
                    className="rounded bg-[var(--surface-2)] px-1.5 py-0.5"
                  >
                    {label}
                  </button>
                );
              })}
              {integrity.scanned_labels.length > 24 ? (
                <span className="opacity-50">+{integrity.scanned_labels.length - 24}</span>
              ) : null}
            </p>
          ) : null}
          {integrity.failed_labels.length > 0 ? (
            <p className="text-amber-300/90">
              Failed: {integrity.failed_labels.slice(0, 12).join(', ')}
            </p>
          ) : null}
          {integrity.empty > 0 ? (
            <p className="opacity-60">{plural(integrity.empty, 'blank page')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
