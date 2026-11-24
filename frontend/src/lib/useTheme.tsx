'use client';

/**
 * Theme engine.
 *
 * The backend stores free-form UI preferences as JSONB (services/studio.py seeds
 * font_family, font_scale, reading_width, accent, palette, dark, density). This
 * hook reads them once, writes them onto :root as CSS custom properties, and
 * exposes an updater that persists through PATCH /api/v1/preferences.
 *
 * Defaults match the backend seed so a first render is never unstyled.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getPreferences, updatePreferences } from './api';
import type { PreferencePayload } from './types';

export const DEFAULT_PREFERENCES: PreferencePayload = {
  font_family: 'editorial-serif',
  font_scale: 1,
  reading_width: '68ch',
  accent: '#7c9cf5',
  palette: 'obsidian',
  dark: true,
  density: 'comfortable',
};

/** Font stacks the Settings customizer offers. */
export const FONT_STACKS: Record<string, string> = {
  'editorial-serif': '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  'clean-sans': '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
};

/** Surface palettes: [background, surface, surface-2, border]. */
export const PALETTES: Record<string, [string, string, string, string]> = {
  obsidian: ['#0b0c10', '#14161c', '#1b1e26', '#272b35'],
  graphite: ['#101113', '#181a1d', '#202328', '#2b2f36'],
  midnight: ['#080b14', '#101724', '#151d2e', '#22304a'],
};

export const ACCENTS: { label: string; value: string }[] = [
  { label: 'Iris', value: '#7c9cf5' },
  { label: 'Teal', value: '#3fbfa8' },
  { label: 'Amber', value: '#e0a458' },
  { label: 'Rose', value: '#e0798f' },
  { label: 'Moss', value: '#8fbf6a' },
];

function hexToRgba(hex: string, alpha: number): string {
  const value = (hex || '').replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return `rgba(124, 156, 245, ${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyPreferences(prefs: PreferencePayload) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const [bg, surface, surface2, border] = PALETTES[prefs.palette] ?? PALETTES.obsidian;

  root.setProperty('--bg', bg);
  root.setProperty('--surface', surface);
  root.setProperty('--surface-2', surface2);
  root.setProperty('--border', border);
  root.setProperty('--accent', prefs.accent);
  // Snippet highlights and focus rings follow the chosen accent.
  root.setProperty('--accent-soft', hexToRgba(prefs.accent, 0.22));
  root.setProperty('--accent-ring', hexToRgba(prefs.accent, 0.5));
  root.setProperty('--font-reading', FONT_STACKS[prefs.font_family] ?? FONT_STACKS['editorial-serif']);
  root.setProperty('--reading-width', prefs.reading_width);
  root.setProperty('--font-scale', String(prefs.font_scale));
  root.setProperty('--density', prefs.density);
}

interface ThemeContextValue {
  prefs: PreferencePayload;
  ready: boolean;
  save: (patch: Partial<PreferencePayload>) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<PreferencePayload>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    applyPreferences(DEFAULT_PREFERENCES);
    getPreferences()
      .then((res) => {
        if (cancelled) return;
        const merged = { ...DEFAULT_PREFERENCES, ...(res?.payload ?? {}) };
        setPrefs(merged);
        applyPreferences(merged);
      })
      .catch(() => {
        /* offline: dark defaults already applied */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (patch: Partial<PreferencePayload>) => {
    const next = { ...prefs, ...patch };
    // Optimistic: the user sees the change before the round trip completes.
    setPrefs(next);
    applyPreferences(next);
    try {
      const saved = await updatePreferences(next);
      const merged = { ...DEFAULT_PREFERENCES, ...(saved?.payload ?? next) };
      setPrefs(merged);
      applyPreferences(merged);
    } catch {
      /* keep the local value; Settings shows the failure */
    }
  }, [prefs]);

  return <ThemeContext.Provider value={{ prefs, ready, save }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
