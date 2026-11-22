'use client';

/**
 * Cold-start wake + session state.
 *
 * Render Free sleeps after inactivity, so the very first request of a session
 * can take ~30s or fail outright. Every screen reads this hook instead of
 * guessing: `status` drives the "Waking up NEXUS engine…" banner, `session`
 * drives the passcode gate, and `health` feeds the Settings system panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { getHealth, getSession } from './api';
import type { HealthResponse, SessionResponse } from './types';

export type WakeStatus = 'loading' | 'ok' | 'degraded' | 'unreachable';

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

export function useWake() {
  const [state, setState] = useState<WakeState>(INITIAL);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const health = await getHealth();
      const session = await getSession();
      setState({
        status: health.status === 'ok' ? 'ok' : 'degraded',
        session,
        health,
        error: null,
        checkedAt: Date.now(),
      });
      setDismissed(false);
    } catch (error) {
      setState({
        status: 'unreachable',
        session: null,
        health: null,
        error: error instanceof Error ? error.message : 'Backend unreachable',
        checkedAt: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return {
    ...state,
    busy,
    retry: check,
    dismiss: () => setDismissed(true),
    showBanner: !dismissed && (state.status === 'unreachable' || state.status === 'degraded'),
    devOpen: Boolean(state.health?.auth?.dev_open_access),
  };
}
