'use client';

/**
 * The three badges that appear on every result, card and table row.
 *
 * Kept together so format, triage and page labels can never drift apart again,
 * and so contrast lives in one CSS surface (`globals.css`) instead of being
 * re-guessed as `opacity-50` in six components.
 */

import { durationLabel, formatLabel, triageLabel, triageTone } from '@/lib/format';

export function FormatPill({
  format,
  className = '',
}: {
  format: string | null | undefined;
  className?: string;
}) {
  return <span className={`badge badge--format ${className}`}>{formatLabel(format)}</span>;
}

export function TriageBadge({
  status,
  className = '',
}: {
  status: string | null | undefined;
  className?: string;
}) {
  return <span className={`badge ${triageTone(status)} ${className}`}>{triageLabel(status)}</span>;
}

/** `Page 93` — a reading anchor, so it is brighter than a taxonomy label. */
export function PageBadge({
  label,
  className = '',
}: {
  label: string | null | undefined;
  className?: string;
}) {
  if (!label) return null;
  return <span className={`badge badge--page ${className}`}>{label}</span>;
}

export function DurationLabel({
  minutes,
  className = '',
}: {
  minutes: number | null | undefined;
  className?: string;
}) {
  const label = durationLabel(minutes);
  if (!label) return null;
  return <span className={className}>{label}</span>;
}
