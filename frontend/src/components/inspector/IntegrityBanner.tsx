'use client';

import type { SegmentIntegrity } from '@/lib/types';

/**
 * Honest extraction audit.
 *
 * Scanned pages and failed extractions are the two ways a searchable library
 * silently lies to you. This banner is shown whenever either exists, and lists
 * the exact labels so the user can jump straight to the affected page.
 */
export default function IntegrityBanner({
  integrity,
  onJump,
}: {
  integrity: SegmentIntegrity | null;
  onJump?: (segmentIndex: number) => void;
}) {
  if (!integrity) return null;

  const hasProblem = integrity.scanned > 0 || integrity.failed > 0 || integrity.empty > 0;
  if (!hasProblem) {
    return (
      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] opacity-60">
        {integrity.segments} segment{integrity.segments === 1 ? '' : 's'} extracted
        {integrity.engine ? ` · ${integrity.engine}` : ''}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px]">
      <p className="font-medium">
        Partial extraction — some pages are not searchable
        {integrity.engine ? ` (${integrity.engine})` : ''}
      </p>
      <p className="opacity-80">
        {integrity.extracted} of {integrity.segments} segments carry text
        {integrity.scanned > 0 ? ` · ${integrity.scanned} scanned image page(s)` : ''}
        {integrity.failed > 0 ? ` · ${integrity.failed} failed` : ''}
        {integrity.empty > 0 ? ` · ${integrity.empty} empty` : ''}
      </p>
      {integrity.scanned_labels.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1 opacity-80">
          <span>Scanned:</span>
          {integrity.scanned_labels.slice(0, 12).map((label, index) => {
            // Labels look like "Page 4"; jump to that segment when a number exists.
            const digits = label.match(/\d+/);
            const target = digits ? Number(digits[0]) : index + 1;
            return (
              <button
                key={`${label}-${index}`}
                type="button"
                onClick={() => onJump?.(target)}
                className="rounded bg-black/20 px-1.5 py-0.5"
              >
                {label}
              </button>
            );
          })}
        </p>
      ) : null}
      {integrity.failed_labels.length > 0 ? (
        <p className="opacity-80">Failed: {integrity.failed_labels.join(', ')}</p>
      ) : null}
    </div>
  );
}
