'use client';

/**
 * Calm, minimalist cold-start banner. "Waking up NEXUS engine…"
 * with retry. Shown when health/auth is waking/unreachable/degraded.
 */

import { useHealth } from '@/lib/useHealth';

export default function WakeBanner() {
  const { showBanner, retry, status, dismissBanner } = useHealth();

  if (!showBanner) return null;

  const message =
    status === 'unreachable'
      ? 'NEXUS engine unreachable.'
      : 'Waking up NEXUS engine…';

  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-white/10 bg-[var(--bg)] px-4 py-2 text-center text-xs text-[var(--font-reading)]"
    >
      <span className="opacity-80">{message}</span>
      <button
        onClick={retry}
        className="ml-3 underline underline-offset-2 opacity-70 hover:opacity-100"
      >
        Retry
      </button>
      <button onClick={dismissBanner} className="ml-2 opacity-50 hover:opacity-90">
        Dismiss
      </button>
    </div>
  );
}
