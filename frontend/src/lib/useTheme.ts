'use client';

/**
 * Theme engine: reads live CSS custom properties and applies overrides
 * from GET /api/v1/preferences with clean dark defaults.
 */

import { useCallback, useEffect, useState } from 'react';
import { getPreferences } from './api';
import { Preferences } from './types';

export interface ThemeTokens {
  bg: string;
  surface: string;
  accent: string;
  fontReading: string;
  readingWidth: number;
  fontScale: number;
}

const DEFAULTS: ThemeTokens = {
  bg: '#0a0a0f',
  surface: '#12121a',
  accent: '#00d4aa',
  fontReading: '#e8e6e3',
  readingWidth: 640,
  fontScale: 1.0,
};

function tokensFromPayload(payload: Record<string, unknown>): ThemeTokens {
  const p = payload || {};
  const fontScaleRaw = Number(p.font_scale ?? p.fontScale ?? DEFAULTS.fontScale);
  const widthRaw = Number(p.reading_width ?? p.readingWidth ?? DEFAULTS.readingWidth);

  return {
    bg: typeof p.bg === 'string' ? p.bg : DEFAULTS.bg,
    surface: typeof p.surface === 'string' ? p.surface : DEFAULTS.surface,
    accent: typeof p.accent === 'string' ? p.accent : DEFAULTS.accent,
    fontReading: typeof p.font_reading === 'string' ? p.font_reading : DEFAULTS.fontReading,
    readingWidth: Number.isFinite(widthRaw) && widthRaw > 0 ? widthRaw : DEFAULTS.readingWidth,
    fontScale: Number.isFinite(fontScaleRaw) && fontScaleRaw > 0 ? fontScaleRaw : DEFAULTS.fontScale,
  };
}

export function useTheme() {
  const [tokens, setTokens] = useState<ThemeTokens>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  const applyTokens = useCallback((t: ThemeTokens) => {
    const root = document.documentElement;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--surface', t.surface);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--font-reading', t.fontReading);
    root.style.setProperty('--reading-width', `${t.readingWidth}px`);
    root.style.setProperty('--font-scale', String(t.fontScale));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await getPreferences();
        const t = tokensFromPayload(prefs?.payload || {});
        if (cancelled) return;
        setTokens(t);
        applyTokens(t);
      } catch {
        // Keep clean dark defaults; surface for later retry via health check.
        if (!cancelled) setTokens(DEFAULTS);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyTokens]);

  const update = useCallback(
    async (next: Partial<ThemeTokens>) => {
      const merged = { ...tokens, ...next };
      setTokens(merged);
      applyTokens(merged);
      try {
        const prefs = await getPreferences();
        const payload = { ...(prefs?.payload || {}), ...next };
        await fetch('/api/v1/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ payload }),
        });
      } catch {
        // local-only until backend reachable
      }
    },
    [tokens, applyTokens]
  );

  return { tokens, loaded, update };
}
