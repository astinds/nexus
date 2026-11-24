/**
 * `ts_headline` snippet splitting, kept framework-free so it can be reasoned
 * about (and exercised) without React.
 *
 * The backend sets `StartSel=<mark>, StopSel=</mark>` (services/search.py). The
 * renderer used to split on `<b>`/`</b>`, so nothing matched and the markup
 * showed up as literal text in every search result. This module owns the rule:
 * split on the delimiters the server actually sends, and never treat document
 * text as HTML.
 */

export type SnippetPart = { text: string; hit: boolean };

export const MARK_OPEN = '<mark>';
export const MARK_CLOSE = '</mark>';

/** Older servers used `<b>`; support both rather than regress on deploy order. */
const LEGACY_OPEN = '<b>';
const LEGACY_CLOSE = '</b>';

export function splitHighlighted(
  snippet: string,
  open: string = MARK_OPEN,
  close: string = MARK_CLOSE
): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let cursor = 0;
  let hit = false;

  while (cursor < snippet.length) {
    const next = hit ? snippet.indexOf(close, cursor) : snippet.indexOf(open, cursor);

    if (next === -1) {
      // Unbalanced delimiter: the remainder is text, never markup.
      const rest = snippet.slice(cursor);
      if (rest) parts.push({ text: rest, hit });
      break;
    }

    if (next > cursor) parts.push({ text: snippet.slice(cursor, next), hit });
    cursor = next + (hit ? close.length : open.length);
    hit = !hit;
  }

  return parts.filter((part) => part.text.length > 0);
}

export function splitSnippet(snippet: string): SnippetPart[] {
  if (!snippet) return [];
  if (snippet.includes(MARK_OPEN)) return splitHighlighted(snippet);
  if (snippet.includes(LEGACY_OPEN)) return splitHighlighted(snippet, LEGACY_OPEN, LEGACY_CLOSE);
  return [{ text: snippet, hit: false }];
}
