/**
 * Label, reader and Markdown checks with no test framework and no dependency.
 *
 * Run with: npm run check:helpers
 *
 * These modules are pure functions, so a plain Node run pins the regressions the
 * passes fixed — `<mark>` snippets rendering as literal text, `segment(s)`-style
 * copy, raw page numbers, and any HTML reaching the Markdown renderer. Requires a
 * Node that strips TypeScript types (23+, or 22.6+ with --experimental-strip-types);
 * it is a developer check, not part of the production build.
 */

import assert from 'node:assert/strict';

import { splitSnippet } from '../src/lib/snippet.ts';
import {
  countParts,
  durationLabel,
  formatCount,
  formatLabel,
  plural,
  resumeLabel,
  triageLabel,
} from '../src/lib/format.ts';
import {
  clampPage,
  pageLabel,
  parsePageInput,
  progressPercent,
  reflow,
  splitByTerm,
} from '../src/lib/reader.ts';
import { inlineSegments, isSafeHref, parseBlocks } from '../src/lib/markdown.ts';

// Search snippets: the backend sends <mark> delimiters (services/search.py).
assert.deepEqual(splitSnippet('the <mark>quick</mark> fox'), [
  { text: 'the ', hit: false },
  { text: 'quick', hit: true },
  { text: ' fox', hit: false },
]);
assert.deepEqual(splitSnippet('plain text'), [{ text: 'plain text', hit: false }]);
assert.deepEqual(splitSnippet('a <b>hit</b> b'), [
  { text: 'a ', hit: false },
  { text: 'hit', hit: true },
  { text: ' b', hit: false },
]);
// An unbalanced delimiter stays text; it is never interpreted as HTML.
assert.deepEqual(splitSnippet('a <mark>dangling'), [
  { text: 'a ', hit: false },
  { text: 'dangling', hit: true },
]);

// Format labels.
assert.equal(formatLabel('pdf'), 'PDF');
assert.equal(formatLabel('docx'), 'DOCX');
assert.equal(formatLabel('web_article'), 'Web Article');
assert.equal(formatLabel('markdown'), 'Note');
assert.equal(formatLabel('note'), 'Note');

// Reading duration and long numbers.
assert.equal(durationLabel(550), '9h 10m');
assert.equal(durationLabel(9), '9 min');
assert.equal(durationLabel(60), '1h');
assert.equal(durationLabel(0), '<1 min');
assert.equal(durationLabel(null), null);
assert.equal(formatCount(109933), '109,933');
assert.equal(formatCount(0), '0');

// Triage labels.
assert.equal(triageLabel('inbox'), 'Inbox');
assert.equal(triageLabel('reading'), 'Reading');
assert.equal(triageLabel('processed'), 'Done');
assert.equal(triageLabel('cold_archive'), 'Archive');

// Plurals and counts.
assert.equal(plural(1, 'segment'), '1 segment');
assert.equal(plural(2, 'segment'), '2 segments');
assert.equal(plural(1, 'scanned page'), '1 scanned page');
assert.equal(plural(3, 'scanned page'), '3 scanned pages');
assert.equal(plural(109933, 'word'), '109,933 words');
assert.equal(
  countParts([
    { count: 1, singular: 'scanned segment' },
    { count: 1, singular: 'failed extraction' },
    { count: 0, singular: 'skipped page' },
  ]),
  '1 scanned segment · 1 failed extraction'
);

// Resume anchors.
assert.equal(resumeLabel('pdf', 8), 'p. 8');
assert.equal(resumeLabel('note', 8), '#8');
assert.equal(resumeLabel('pdf', 0), 'Start reading');

// Reflow: soft line breaks join, display hyphens heal, paragraphs stay apart.
assert.equal(reflow('the quick\nbrown fox'), 'the quick brown fox');
assert.equal(reflow('fanat-\nically'), 'fanatically');
assert.equal(reflow('one\n\ntwo'), 'one\n\ntwo');
assert.equal(reflow(''), '');

// Page arithmetic is clamped and 1-based, never 0.
assert.equal(clampPage(0, 278), 1);
assert.equal(clampPage(999, 278), 278);
assert.equal(clampPage(14, 278), 14);
assert.equal(pageLabel(14, 278), 'Page 14 of 278');
assert.equal(progressPercent(1, 100), 0);
assert.equal(progressPercent(50, 100), 49);
assert.equal(progressPercent(100, 100), 99);
assert.equal(parsePageInput('93'), 93);
assert.equal(parsePageInput('  93 '), 93);
assert.equal(parsePageInput('0'), null);
assert.equal(parsePageInput('abc'), null);
assert.equal(parsePageInput('-4'), null);

// Search highlighting without HTML.
assert.deepEqual(splitByTerm('influence and influence', 'influence'), [
  { text: 'influence', hit: true },
  { text: ' and ', hit: false },
  { text: 'influence', hit: true },
]);
assert.deepEqual(splitByTerm('plain', ''), [{ text: 'plain', hit: false }]);

// Markdown blocks and inline spans.
const md = [
  '# Title',
  '',
  'Some **bold** and *italic* with `code` and a [link](https://example.com).',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '> quoted',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '---',
].join('\n');

const blocks = parseBlocks(md);
assert.deepEqual(
  blocks.map((block) => block.kind),
  ['heading', 'paragraph', 'list', 'quote', 'code', 'hr']
);
assert.equal(blocks[0].level, 1);
assert.equal(blocks[2].items[0].task, true);
assert.equal(blocks[2].items[1].task, false);
assert.equal(blocks[4].lang, 'js');

const inline = inlineSegments('a **b** *c* `d` [e](https://x.test)');
assert.deepEqual(
  inline.map((token) => token.type),
  ['text', 'bold', 'text', 'italic', 'text', 'code', 'text', 'link']
);
assert.equal(inline.at(-1).safe, true);

// Unsafe hrefs are refused, so a note cannot smuggle a javascript: URL.
assert.equal(inlineSegments('[x](javascript:alert(1))')[0].safe, false);
assert.equal(isSafeHref('data:text/html,<script>'), false);
assert.equal(isSafeHref('/library'), true);

// Raw HTML is text, never markup.
assert.deepEqual(parseBlocks('<script>alert(1)</script>')[0], {
  kind: 'paragraph',
  text: '<script>alert(1)</script>',
});

console.log('format + snippet + reader + markdown checks passed');
