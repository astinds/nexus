'use client';

/**
 * Calm cold-start banner. Shown only while the backend is waking or degraded,
 * with an explicit retry — never an error wall on first paint.
 */

import { useWake } from '@/lib/useHealth';

export default function WakeBanner() {
  const { showBanner, status, busy, retry, dismiss, error } = useWake();

  if (!showBanner) return null;

  const message =
    status === 'degraded'
      ? 'NEXUS is running with a degraded dependency.'
      : 'Waking up NEXUS engine…';

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs"
    >
      <span className="opacity-80">{message}</span>
      {error ? <span className="opacity-40">{error}</span> : null}
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="underline underline-offset-2 opacity-70 hover:opacity-100 disabled:opacity-40"
      >
        {busy ? 'Retrying…' : 'Retry'}
      </button>
      <button type="button" onClick={dismiss} className="opacity-50 hover:opacity-90">
        Dismiss
      </button>
    </div>
  );
}
