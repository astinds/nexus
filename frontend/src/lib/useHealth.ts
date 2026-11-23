/**
 * Cold-start probe.
 *
 * Render Free sleeps after 15 minutes and needs ~45 s to answer the first
 * request. The old hook made one attempt and flipped straight to "unreachable",
 * so every wake-up looked like an outage. This version:
 *
 *   * shows the calm "Waking up NEXUS engine…" banner at ~3 s instead of
 *     leaving a bare spinner;
 *   * keeps re-probing and only says "unreachable" after the full ~60 s wake
 *     window has elapsed (the same budget api.ts gives `/health`).
 *
 * It still trusts the server's own verdict: `status` drives the banner,
 * `session` drives the passcode gate, and `health` feeds the Settings panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, getSession } from './api';
import type { HealthResponse, SessionResponse } from './types';

export type WakeStatus = 'loading' | 'waking' | 'ok' | 'degraded' | 'unreachable';

export interface WakeState {
  status: WakeStatus;
  session: SessionResponse | null;
  health: HealthResponse | null;
  error: string | null;
  checkedAt: number | null;
}

const INITIAL: WakeState = {
  status: 'loading',
  session: null,
  health: null,
  error: null,
  checkedAt: null,
};

/** Show the banner early: a slow first byte almost always means a cold start. */
const WAKING_BANNER_MS = 3_000;

/** Matches TIMEOUT_HEALTH_MS in api.ts — the full Render wake window. */
const WAKE_WINDOW_MS = 60_000;

/** Pause between probes inside the wake window. */
const PROBE_GAP_MS = 3_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useWake() {
  const [state, setState] = useState<WakeState>(INITIAL);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  // Generation counter: a retry() while a probe loop is still waiting starts a new
  // generation, and the old loop exits at its next check. Without this, tapping
  // Retry during a cold start could leave two 60 s /health probes in flight.
  const runId = useRef(0);

  const check = useCallback(async () => {
    const mine = ++runId.current;
    cancelled.current = false;
    const stillCurrent = () => runId.current === mine && !cancelled.current;
    setBusy(true);
    setState((prev) => (prev.status === 'ok' ? prev : { ...prev, status: 'loading' }));

    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      if (!stillCurrent()) return;
      setState((prev) =>
        prev.status === 'loading' ? { ...prev, status: 'waking' } : prev,
      );
    }, WAKING_BANNER_MS);

    const startedAt = Date.now();
    let lastError: unknown = null;

    // Strictly sequential: each probe is awaited before the next begins.
    while (stillCurrent()) {
      try {
        const health = await getHealth(); // 60 s budget, one retry inside api.ts
        if (!stillCurrent()) return;
        const session = await getSession();
        if (!stillCurrent()) return;
        setState({
          status: health.status === 'ok' ? 'ok' : 'degraded',
          session,
          health,
          error: null,
          checkedAt: Date.now(),
        });
        setDismissed(false);
        break;
      } catch (error) {
        if (!stillCurrent()) return;
        lastError = error;
        // Inside the wake window this is expected; keep waiting calmly.
        if (Date.now() - startedAt >= WAKE_WINDOW_MS) {
          setState({
            status: 'unreachable',
            session: null,
            health: null,
            error: error instanceof Error ? error.message : 'Backend unreachable',
            checkedAt: Date.now(),
          });
          break;
        }
        setState((prev) => ({ ...prev, status: 'waking' }));
        await sleep(PROBE_GAP_MS);
      }
    }

    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
    void lastError;
    if (runId.current === mine) setBusy(false);
  }, []);

  useEffect(() => {
    void check();
    return () => {
      cancelled.current = true;
      runId.current += 1; // invalidate any in-flight probe loop
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, [check]);

  return {
    ...state,
    busy,
    retry: check,
    dismiss: () => setDismissed(true),
    showBanner:
      !dismissed &&
      (state.status === 'waking' ||
        state.status === 'unreachable' ||
        state.status === 'degraded'),
    devOpen: Boolean(state.health?.auth?.dev_open_access),
  };
}
