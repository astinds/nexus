'use client';

/**
 * Renders a PostgreSQL `ts_headline` snippet without raw HTML injection.
 *
 * `ts_headline` only adds its configured start/end delimiters (`<b>`/`</b>` by
 * default) around matched terms; the document text between them is untrusted.
 * This splits on those delimiters and renders the pieces as React text nodes,
 * so any HTML that happens to live in the document is escaped by React instead
 * of being interpreted. No `dangerouslySetInnerHTML` anywhere.
 */

const OPEN = '<b>';
const CLOSE = '</b>';

export function splitHighlighted(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  let hit = false;

  while (cursor < snippet.length) {
    const next = hit ? snippet.indexOf(CLOSE, cursor) : snippet.indexOf(OPEN, cursor);

    if (next === -1) {
      parts.push({ text: snippet.slice(cursor), hit });
      break;
    }

    if (next > cursor) parts.push({ text: snippet.slice(cursor, next), hit });
    cursor = next + (hit ? CLOSE.length : OPEN.length);
    hit = !hit;
  }

  return parts.filter((part) => part.text.length > 0);
}

export default function HighlightedSnippet({
  snippet,
  className = '',
}: {
  snippet: string;
  className?: string;
}) {
  if (!snippet) return null;

  return (
    <p className={`text-sm leading-relaxed opacity-80 ${className}`}>
      {splitHighlighted(snippet).map((part, index) =>
        part.hit ? (
          <strong key={index} className="font-semibold text-[var(--accent)]">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </p>
  );
}
