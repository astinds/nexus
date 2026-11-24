'use client';

/**
 * Renders a PostgreSQL `ts_headline` snippet without raw HTML injection.
 *
 * The splitting rule lives in lib/snippet.ts; this component only maps the
 * resulting parts to text nodes and `<mark>` elements, so HTML inside a
 * document is escaped by React instead of being interpreted. No
 * `dangerouslySetInnerHTML` anywhere.
 */

import { splitSnippet } from '@/lib/snippet';

export { splitHighlighted, splitSnippet } from '@/lib/snippet';

export default function HighlightedSnippet({
  snippet,
  className = '',
}: {
  snippet: string;
  className?: string;
}) {
  if (!snippet) return null;

  return (
    <p className={`snippet text-sm leading-relaxed text-[var(--text-muted)] ${className}`}>
      {splitSnippet(snippet).map((part, index) =>
        part.hit ? (
          <mark key={index} className="snippet-mark">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </p>
  );
}
