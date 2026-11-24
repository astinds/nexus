/**
 * Label and snippet checks with no test framework and no extra dependency.
 *
 * Run with: npm run check:helpers
 *
 * These two modules are pure functions, so a plain Node run is enough to pin the
 * regressions this pass fixed — notably `<mark>` snippets rendering as literal
 * text, and `segment(s)`-style copy. Requires a Node that can strip TypeScript
 * types (Node 23+, or 22.6+ with --experimental-strip-types); it is a developer
 * check, not part of the production build.
 */

import assert from 'node:assert/strict';

import { splitSnippet } from '../src/lib/snippet.ts';
import {
  countParts,
  durationLabel,
  formatLabel,
  plural,
  resumeLabel,
  triageLabel,
} from '../src/lib/format.ts';

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

// Reading duration.
assert.equal(durationLabel(550), '9h 10m');
assert.equal(durationLabel(9), '9 min');
assert.equal(durationLabel(60), '1h');
assert.equal(durationLabel(0), '<1 min');
assert.equal(durationLabel(null), null);

// Triage labels.
assert.equal(triageLabel('inbox'), 'Inbox');
assert.equal(triageLabel('reading'), 'Reading');
assert.equal(triageLabel('processed'), 'Done');
assert.equal(triageLabel('cold_archive'), 'Archive');

// Plurals and counts.
assert.equal(plural(1, 'segment'), '1 segment');
assert.equal(plural(2, 'segment'), '2 segments');
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

console.log('format + snippet checks passed');
