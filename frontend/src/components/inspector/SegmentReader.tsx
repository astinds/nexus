'use client';

import type { Segment } from '@/lib/types';

/**
 * Segmented text reader for every non-PDF format.
 *
 * PDFs get a canvas viewer, but DOCX, Markdown, CSV, JSON and web clips are
 * already extracted text: a labelled segment list is both lighter and more
 * honest about where a search hit came from.
 */
export default function SegmentReader({
  segments,
  activeIndex,
  onSelect,
}: {
  segments: Segment[];
  activeIndex: number | null;
  onSelect: (segment: Segment) => void;
}) {
  if (segments.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm opacity-60">
        This item has no extracted segments yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {segments.map((segment) => {
          const active = segment.segment_index === activeIndex;
          const bad = segment.is_scanned || segment.extraction_status === 'failed';
          return (
            <button
              key={segment.id}
              type="button"
              onClick={() => onSelect(segment)}
              title={segment.segment_label}
              className={`rounded px-2 py-1 text-[11px] ${
                active
                  ? 'bg-[var(--accent)] text-black'
                  : bad
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-[var(--surface-2)] opacity-70 hover:opacity-100'
              }`}
            >
              {segment.segment_index}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {segments.map((segment) => {
          const active = segment.segment_index === activeIndex;
          return (
            <article
              key={segment.id}
              id={`segment-${segment.segment_index}`}
              className={`rounded-xl border p-4 transition-colors ${
                active
                  ? 'border-[var(--accent)]/60 bg-[var(--surface)]'
                  : 'border-[var(--border)] bg-[var(--surface)]'
              }`}
            >
              <header className="mb-2 flex items-center justify-between gap-2 text-[11px] opacity-50">
                <span>{segment.segment_label}</span>
                {segment.is_scanned ? (
                  <span className="text-amber-300">scanned image</span>
                ) : segment.extraction_status === 'failed' ? (
                  <span className="text-amber-300">extraction failed</span>
                ) : segment.extraction_status === 'empty' ? (
                  <span>empty</span>
                ) : null}
              </header>

              {segment.content.trim() ? (
                <div className="prose-reading text-sm">{segment.content}</div>
              ) : (
                <p className="text-sm opacity-40">
                  No text on this segment — it is likely a scanned image.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
