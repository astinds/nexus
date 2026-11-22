'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import { getDashboard } from '@/lib/api';
import type { DashboardStats } from '@/lib/types';

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider opacity-60">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] opacity-50">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [capture, setCapture] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboard()
      .then((res) => !cancelled && setStats(res))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err.message : 'Dashboard unavailable')
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = stats?.totals ?? {};

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <button
            type="button"
            onClick={() => setCapture(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-black"
          >
            Quick capture
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('q');
            const query = typeof value === 'string' ? value.trim() : '';
            if (query) window.location.href = `/search?q=${encodeURIComponent(query)}`;
          }}
          className="flex gap-2"
        >
          <input
            name="q"
            type="search"
            placeholder="Search everything…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button type="submit" className="rounded-lg border border-[var(--border)] px-3 text-xs">
            Go
          </button>
        </form>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}

        {!stats && !error ? <p className="text-sm opacity-50">Loading…</p> : null}

        {stats ? (
          <>
            <Panel title="Library">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure label="Items" value={totals.items ?? 0} />
                <Figure label="Inbox" value={totals.inbox ?? 0} />
                <Figure label="Reading" value={totals.reading ?? 0} />
                <Figure label="Segments" value={totals.segments ?? 0} />
              </div>
              {stats.scanned_segments > 0 || stats.failed_extractions > 0 ? (
                <p className="mt-3 text-[11px] text-amber-300">
                  {stats.scanned_segments} scanned segment(s) ·{' '}
                  {stats.failed_extractions} failed extraction(s)
                </p>
              ) : null}
            </Panel>

            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="By format">
                {Object.keys(stats.by_format).length === 0 ? (
                  <p className="text-xs opacity-50">Nothing captured yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(stats.by_format).map(([format, count]) => (
                      <Figure key={format} label={format.replace(/_/g, ' ')} value={count} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="By blueprint">
                {Object.keys(stats.by_blueprint).length === 0 ? (
                  <p className="text-xs opacity-50">No blueprint assigned yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(stats.by_blueprint).map(([name, count]) => (
                      <Figure key={name} label={name} value={count} />
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <Panel
              title="Continue reading"
              action={
                <Link href="/library" className="text-[11px] opacity-60 hover:opacity-100">
                  Library →
                </Link>
              }
            >
              {stats.continue_reading.length === 0 ? (
                <p className="text-xs opacity-50">Nothing in progress.</p>
              ) : (
                <ul className="space-y-1">
                  {stats.continue_reading.map((item) => {
                    const segment = Number(item.reading_progress?.segment_index ?? 0);
                    return (
                      <li key={item.id}>
                        <Link
                          href={`/items/${item.id}${segment ? `?segment=${segment}` : ''}`}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                        >
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="shrink-0 text-[10px] uppercase opacity-50">
                            {segment ? `resume ${segment}` : 'start'}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Recently added">
              {stats.recently_added.length === 0 ? (
                <p className="text-xs opacity-50">No items yet.</p>
              ) : (
                <ul className="space-y-1">
                  {stats.recently_added.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/items/${item.id}`}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase opacity-60">
                          {item.source_format}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {stats.recent_activity.length > 0 ? (
              <Panel title="Recent activity">
                <ul className="space-y-1.5 text-xs">
                  {stats.recent_activity.map((entry) => (
                    <li key={entry.id} className="flex gap-2 opacity-70">
                      <span className="shrink-0 text-[10px] uppercase opacity-50">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>
                      <span className="min-w-0 truncate">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </>
        ) : null}
      </div>

      {capture ? <OmniCaptureModal onClose={() => setCapture(false)} /> : null}
    </Shell>
  );
}
