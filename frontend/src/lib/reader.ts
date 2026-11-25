/**
 * Pure helpers behind the reader.
 *
 * Everything here is display-only and side-effect free, so `npm run check:helpers`
 * can pin the behaviour without a DOM or a test framework. Nothing in this file
 * mutates stored text: de-hyphenation is applied while rendering and the segment
 * in PostgreSQL keeps its original line breaks.
 */

/**
 * Rejoin soft line breaks produced by PDF text layers.
 *
 * A hard-wrapped paragraph arrives as one line per visual row; rendering those
 * literally gives a ragged column on a phone. Lines that end mid-sentence are
 * joined with a space, and a display hyphen followed by a lower-case word is
 * treated as a split word: `fanat-` + `ically` -> `fanatically`.
 */
export function reflow(text: string): string {
  if (!text) return '';
  // De-hyphenate across the break first (hyphen + optional spaces + newline).
  const dehyphenated = text.replace(/(\p{Ll})[-‐‑]\s*\n\s*(\p{Ll})/gu, '$1$2');
  // Then join the remaining single newlines inside a paragraph.
  return dehyphenated
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

/** Clamp a page number into `1..total`; `1` when the total is unknown. */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  if (!Number.isFinite(total) || total < 1) return Math.max(1, Math.round(page));
  return Math.min(Math.max(1, Math.round(page)), Math.round(total));
}

/** `Page 14 of 278` — the reader's position line. */
export function pageLabel(page: number, total: number): string {
  const safeTotal = Math.max(1, Math.round(total || 1));
  return `Page ${clampPage(page, safeTotal)} of ${safeTotal.toLocaleString('en-US')}`;
}

/** Percentage read, clamped to 0..100 and rounded to a whole number. */
export function progressPercent(page: number, total: number): number {
  if (!total || total < 1) return 0;
  return Math.min(100, Math.max(0, Math.round(((page - 1) / total) * 100)));
}

/**
 * Parse a typed page number. Returns `null` for anything that is not a positive
 * integer, so the caller can ignore a stray keystroke instead of jumping to 1.
 */
export function parsePageInput(raw: string): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 ? value : null;
}

/**
 * Case-insensitive match ranges for the searched term, used to highlight the hit
 * in Reflow mode. Returns `[]` for an empty needle so callers can render plainly.
 */
export function matchRanges(haystack: string, needle: string): Array<[number, number]> {
  const term = (needle ?? '').trim();
  if (!term || !haystack) return [];
  const ranges: Array<[number, number]> = [];
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = term.toLowerCase();
  let from = 0;
  while (from <= lowerHay.length - lowerNeedle.length) {
    const at = lowerHay.indexOf(lowerNeedle, from);
    if (at === -1) break;
    ranges.push([at, at + lowerNeedle.length]);
    from = at + lowerNeedle.length;
  }
  return ranges;
}

/**
 * Split text into plain/hit chunks for highlighting without HTML.
 * Mirrors `snippet.ts`, but for literal search terms rather than `<mark>` tags.
 */
export function splitByTerm(
  text: string,
  needle: string,
): Array<{ text: string; hit: boolean }> {
  const ranges = matchRanges(text, needle);
  if (ranges.length === 0) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}
