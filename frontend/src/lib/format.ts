/**
 * Display formatting shared by Dashboard, Library (cards + table) and Search.
 *
 * One module so `pdf` never renders as "PDF" in one place and "pdf" in another,
 * and so pluralised counts stop leaking "segment(s)" into the UI.
 */

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  markdown: 'Note',
  note: 'Note',
  text: 'Text',
  csv: 'CSV',
  json: 'JSON',
  html: 'Text',
  web_article: 'Web Article',
};

const TRIAGE_LABELS: Record<string, string> = {
  inbox: 'Inbox',
  reading: 'Reading',
  processed: 'Done',
  evergreen: 'Evergreen',
  cold_archive: 'Archive',
};

/** Semantic tints keyed by triage state; classes live in globals.css. */
const TRIAGE_TONES: Record<string, string> = {
  inbox: 'badge--inbox',
  reading: 'badge--reading',
  processed: 'badge--done',
  evergreen: 'badge--evergreen',
  cold_archive: 'badge--archive',
};

export type TriageTone = keyof typeof TRIAGE_TONES;

/** `web_article` -> `Web Article`, `pdf` -> `PDF`, `markdown` -> `Note`. */
export function formatLabel(format: string | null | undefined): string {
  const key = (format ?? '').trim().toLowerCase();
  if (!key) return 'Unknown';
  if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `cold_archive` -> `Archive`, `processed` -> `Done`. */
export function triageLabel(status: string | null | undefined): string {
  const key = (status ?? '').trim().toLowerCase();
  if (!key) return 'Inbox';
  return TRIAGE_LABELS[key] ?? formatLabel(key);
}

export function triageTone(status: string | null | undefined): string {
  const key = (status ?? '').trim().toLowerCase();
  return TRIAGE_TONES[key] ?? 'badge--archive';
}

/**
 * Reading time: `550` -> `9h 10m`, `42` -> `42 min`, `0` -> `<1 min`.
 *
 * Returns `null` for an unknown duration so callers can omit the label instead
 * of rendering "0 min" on an item that was never measured.
 */
export function durationLabel(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return null;
  const total = Math.max(0, Math.round(Number(minutes)));
  if (total < 1) return '<1 min';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `1 segment` / `3 segments` — never `segment(s)`. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = Math.abs(count) === 1 ? singular : pluralForm ?? `${singular}s`;
  return `${count} ${word}`;
}

/** Shorthand that reads naturally in a sentence: `1 scanned segment · 1 failure`. */
export function countParts(parts: { count: number; singular: string; plural?: string }[]): string {
  return parts
    .filter((part) => part.count > 0)
    .map((part) => plural(part.count, part.singular, part.plural))
    .join(' · ');
}

/** `Resume · p. 8` for paged documents, `Resume · #8` otherwise. */
export function resumeLabel(format: string | null | undefined, segment: number): string {
  if (!segment) return 'Start reading';
  const paged = ['pdf', 'docx'].includes((format ?? '').toLowerCase());
  return paged ? `p. ${segment}` : `#${segment}`;
}

/** Compact relative time for activity rows: `just now`, `4h ago`, `3d ago`. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** `1.4 MB` / `812 KB` for upload previews. */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
