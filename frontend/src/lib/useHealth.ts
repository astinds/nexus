'use client';

/**
 * Cold-start wake + health state.
 * If /api/v1/health or /api/v1/auth/session is waking/unreachable/degraded,
 * surface a calm "Waking up NEXUS engine…" banner with retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, getSession } from './api';

export type HealthStatus = 'loading' | 'ok' | 'degraded' | 'unreachable';

export interface HealthState {
  status: HealthStatus;
  checkedAt: number | null;
  authMode: 'dev_open' | 'key' | 'locked' | null;
  devOpenAccess: boolean;
}

export function useHealth() {
  const [state, setState] = useState<HealthState>({
    status: 'loading',
    checkedAt: null,
    authMode: null,
    devOpenAccess: false,
  });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      const health = await getHealth();
      const session = await getSession();
      const ok = health.status === 'ok';
      setState({
        status: ok ? 'ok' : 'degraded',
        checkedAt: Date.now(),
        authMode: session.mode === 'dev_open' ? 'dev_open' : session.mode,
        devOpenAccess: !!health.auth?.dev_open_access,
      });
    } catch {
      setState({ status: 'unreachable', checkedAt: Date.now(), authMode: null, devOpenAccess: false });
    }
  }, []);

  useEffect(() => {
    void check();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [check]);

  const retry = useCallback(() => {
    void check();
  }, [check]);

  const showBanner = state.status !== 'ok' && !bannerDismissed;

  return { ...state, showBanner, retry, dismissBanner: () => setBannerDismissed(true), check };
}
