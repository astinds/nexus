'use client';

/**
 * Frontend-only invalidation bus.
 *
 * The backend has no streaming channel, so "instant" means: after a mutation
 * succeeds, tell every mounted screen to re-fetch. Capture lives in a sheet on
 * top of Dashboard/Library, so the list behind it updates while it closes; a
 * capture that happened on another route is picked up on focus or when the tab
 * becomes visible again.
 *
 * No polling, no new endpoints, no preference changes.
 */

import { useEffect, useRef } from 'react';

const EVENT = 'nexus:data-changed';
const VERSION_KEY = 'nexus:data-version';

const listeners = new Set<() => void>();
let version = 0;

/** Call after any successful ingest, triage change, edit or delete. */
export function notifyDataChanged(): void {
  version += 1;
  try {
    // Lets a freshly mounted screen see that something changed before it loaded.
    window.sessionStorage.setItem(VERSION_KEY, String(version));
    // Fires in other tabs too.
    window.localStorage.setItem(VERSION_KEY, String(version));
  } catch {
    /* storage can be blocked (private mode); in-page listeners still work */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: version }));
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* one broken subscriber must not block the rest */
    }
  });
}

/** Subscribe to invalidation from this tab, other tabs, and tab focus. */
export function useLiveData(refresh: () => void): void {
  const handler = useRef(refresh);
  handler.current = refresh;

  useEffect(() => {
    const run = () => handler.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === VERSION_KEY) run();
    };

    window.addEventListener(EVENT, run);
    window.addEventListener('focus', run);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(EVENT, run);
      window.removeEventListener('focus', run);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
