'use client';

/**
 * Reflow reader: the phone-first view of a PDF's extracted text.
 *
 * A 612pt page does not fit a 390px screen, and pinch-zooming a scan to read a
 * paragraph is the worst part of every mobile PDF app. Reflow renders the text
 * the extractor already produced, in the reader's own typography, with the page
 * boundaries kept so a search hit still lands on the right page.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Segment } from '@/lib/types';
import { pageLabel, progressPercent, reflow, splitByTerm } from '@/lib/reader';

export default function ReflowView({
  segments,
  page,
  onPage,
  highlight,
}: {
  segments: Segment[];
  page: number;
  onPage: (page: number) => void;
  /** Search term to mark, or empty. */
  highlight: string;
}) {
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const total = segments.length;
  const current = segments[Math.max(0, Math.min(page - 1, total - 1))];

  // Scroll the requested page into view when the page changes from outside the
  // reader (search jump, dashboard resume, scrubber).
  useEffect(() => {
    const node = pageRefs.current.get(page);
    if (node) node.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [page]);

  const body = useMemo(() => {
    if (!current) return [];
    return splitByTerm(reflow(current.content), highlight);
  }, [current, highlight]);

  if (total === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm opacity-60">
        This document has no extracted text yet. Try the PDF view.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-subtle)]">
        <span className="tabular-nums">{pageLabel(page, total)}</span>
        <span className="tabular-nums">{progressPercent(page, total)}%</span>
      </div>

      <div
        className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuenow={progressPercent(page, total)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading progress"
      >
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-200"
          style={{ width: `${progressPercent(page, total)}%` }}
        />
      </div>

      {current ? (
        <article
          ref={(node) => {
            if (node) pageRefs.current.set(page, node);
            else pageRefs.current.delete(page);
          }}
          className="prose-reading whitespace-pre-line text-[15px]"
        >
          {body.length === 0 ? (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs opacity-60">
              {current.extraction_status === 'scanned'
                ? 'This page looks like a scan or an image, so it has no text layer. Switch to PDF to read it.'
                : 'No text was extracted from this page.'}
            </p>
          ) : (
            body.map((part, index) =>
              part.hit ? (
                <mark key={index} className="rounded bg-[var(--accent-soft)] px-0.5">
                  {part.text}
                </mark>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )
          )}
        </article>
      ) : null}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-40"
        >
          Prev
        </button>
        <input
          type="range"
          min={1}
          max={total}
          value={page}
          onChange={(event) => onPage(Number(event.target.value))}
          aria-label="Page scrubber"
          className="h-1 flex-1 accent-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => onPage(Math.min(total, page + 1))}
          disabled={page >= total}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
