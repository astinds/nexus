/**
 * Markdown parsing, kept free of JSX so `npm run check:helpers` can exercise it
 * with plain Node. Rendering lives in `components/MarkdownView.tsx`.
 *
 * The whole point of this module is that no HTML string is ever produced: a note
 * is user-authored and a web article is third-party, so the parser hands back
 * tokens and the component turns each token into a React element.
 */

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; task: boolean | null }> }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'hr' };

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string; safe: boolean };

/** Split a document into block-level chunks. */
export function parseBlocks(source: string): Block[] {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushParagraph = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[1] ?? '' });
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'quote', text: quote.join('\n').trim() });
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: Array<{ text: string; task: boolean | null }> = [];
      while (index < lines.length) {
        const nextBullet = lines[index].match(/^\s*[-*+]\s+(.*)$/);
        const nextNumbered = lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered ? !nextNumbered : !nextBullet) break;
        const raw = (ordered ? nextNumbered![1] : nextBullet![1]).trim();
        const task = raw.match(/^\[( |x|X)\]\s*(.*)$/);
        items.push(
          task
            ? { text: task[2], task: task[1].toLowerCase() === 'x' }
            : { text: raw, task: null },
        );
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    buffer.push(line);
  }

  flushParagraph();
  return blocks;
}

const INLINE_RE = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Safe hrefs only: absolute http(s), mailto, or a site-relative path. */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/)/i.test(href ?? '');
}

/** Inline spans: bold, italic, code and links. Never raw HTML. */
export function inlineSegments(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text ?? '')) !== null) {
    if (match.index > cursor) {
      tokens.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    if (match[2] !== undefined) {
      tokens.push({ type: 'bold', text: match[2] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'italic', text: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: 'code', text: match[5] });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      tokens.push({
        type: 'link',
        text: match[6],
        href: match[7],
        safe: isSafeHref(match[7]),
      });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < (text ?? '').length) {
    tokens.push({ type: 'text', text: text.slice(cursor) });
  }
  return tokens;
}

/** Plain-text projection, used for word counts and quote capture. */
export function toPlainText(source: string): string {
  return parseBlocks(source)
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return block.text;
        case 'list':
          return block.items.map((item) => item.text).join('\n');
        case 'code':
          return block.text;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
