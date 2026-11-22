'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { exportLibraryUrl, getHealth, getIngestFormats } from '@/lib/api';
import { ACCENTS, FONT_STACKS, PALETTES, useTheme } from '@/lib/useTheme';
import type { HealthResponse, IngestFormats } from '@/lib/types';

const WIDTHS = ['58ch', '68ch', '76ch'];
const DENSITIES = ['compact', 'comfortable', 'spacious'];

const API_SNIPPET = `# Paste a note or article (multipart form)
curl -X POST "$NEXUS/api/v1/ingest" \\
  -H "X-Nexus-Key: $KEY" \\
  -F "text=# Title\\n\\nBody" \\
  -F "source_format=note"

# Programmatic item creation (JSON)
curl -X POST "$NEXUS/api/v1/items" \\
  -H "X-Nexus-Key: $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Reading list","source_format":"note","content":"...","tags":["inbox"]}'`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-[10px] uppercase tracking-wider opacity-50">{title}</h2>
      {children}
    </section>
  );
}

const chip = 'rounded-md border px-2 py-1 text-[11px]';
const chipOn = 'border-[var(--accent)] text-[var(--accent)]';
const chipOff = 'border-[var(--border)] opacity-60 hover:opacity-100';

export default function SettingsPage() {
  const { prefs, save } = useTheme();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [formats, setFormats] = useState<IngestFormats | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    getIngestFormats()
      .then(setFormats)
      .catch(() => setFormats(null));
  }, []);

  const update = async (patch: Parameters<typeof save>[0]) => {
    setNotice('');
    await save(patch);
    setNotice('Appearance saved.');
  };

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="mb-1 text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-xs opacity-50">
            Preferences are stored in the backend and applied live as CSS custom properties.
          </p>
        </div>

        <Section title="Reading font">
          <div className="flex flex-wrap gap-1">
            {Object.keys(FONT_STACKS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => update({ font_family: key })}
                className={`${chip} ${prefs.font_family === key ? chipOn : chipOff}`}
                style={{ fontFamily: FONT_STACKS[key] }}
              >
                {key.replace('-', ' ')}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Palette">
          <div className="flex flex-wrap gap-1">
            {Object.keys(PALETTES).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => update({ palette: key })}
                className={`${chip} ${prefs.palette === key ? chipOn : chipOff}`}
              >
                {key}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Accent">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.value}
                type="button"
                aria-label={accent.label}
                onClick={() => update({ accent: accent.value })}
                className="h-7 w-7 rounded-full border-2"
                style={{
                  background: accent.value,
                  borderColor: prefs.accent === accent.value ? '#fff' : 'transparent',
                }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom accent"
              value={prefs.accent}
              onChange={(event) => update({ accent: event.target.value })}
              className="h-7 w-10 rounded border border-[var(--border)] bg-transparent"
            />
          </div>
        </Section>

        <Section title="Reading width and scale">
          <div className="flex flex-wrap gap-1">
            {WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                onClick={() => update({ reading_width: width })}
                className={`${chip} ${prefs.reading_width === width ? chipOn : chipOff}`}
              >
                {width}
              </button>
            ))}
          </div>
          <label className="block text-[11px] opacity-60">
            Font scale · {Number(prefs.font_scale).toFixed(2)}×
            <input
              type="range"
              min={0.85}
              max={1.4}
              step={0.05}
              value={Number(prefs.font_scale)}
              onChange={(event) => void save({ font_scale: Number(event.target.value) })}
              className="mt-1 w-full accent-[var(--accent)]"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {DENSITIES.map((density) => (
              <button
                key={density}
                type="button"
                onClick={() => update({ density })}
                className={`${chip} ${prefs.density === density ? chipOn : chipOff}`}
              >
                {density}
              </button>
            ))}
          </div>
          <div className="prose-reading rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
            NEXUS keeps capture frictionless: one field is optional, none are required. This
            paragraph previews the reading width and scale above.
          </div>
          {notice ? <p className="text-[11px] opacity-60">{notice}</p> : null}
        </Section>

        <Section title="System health">
          {!health ? (
            <p className="text-[11px] opacity-50">Backend unreachable.</p>
          ) : (
            <div className="space-y-2 text-[11px]">
              <p className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    health.status === 'ok' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <span className="opacity-70">
                  {health.status} · v{health.version} · auth {health.auth.mode}
                </span>
              </p>
              <p className="opacity-50">
                max upload {health.limits.max_upload_mb} MB · page size{' '}
                {health.limits.page_size_default}–{health.limits.page_size_max}
              </p>
              <ul className="space-y-0.5">
                {health.engines.map((engine) => (
                  <li key={engine.engine} className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        engine.available ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                    <span className="font-mono">{engine.engine}</span>
                    <span className="min-w-0 truncate opacity-40">{engine.detail}</span>
                  </li>
                ))}
              </ul>
              {health.warnings.length > 0 ? (
                <ul className="space-y-0.5 text-amber-300">
                  {health.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {formats ? (
                <p className="opacity-50">
                  {formats.formats.length} formats · file-only:{' '}
                  {formats.file_only.join(', ') || 'none'}
                </p>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Backup">
          <a
            href={exportLibraryUrl()}
            className="inline-block rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-black"
          >
            Download full library ZIP
          </a>
          <p className="text-[11px] opacity-50">
            Every item, its segments, tags and collections, streamed as one archive.
          </p>
        </Section>

        <Section title="API reference">
          <pre className="overflow-x-auto rounded-lg bg-[var(--bg)] p-3 text-[10px] leading-relaxed opacity-70">
            {API_SNIPPET}
          </pre>
          <p className="text-[11px] opacity-50">
            Interactive docs live at <span className="font-mono">/docs</span> on the backend.
          </p>
        </Section>
      </div>
    </Shell>
  );
}
