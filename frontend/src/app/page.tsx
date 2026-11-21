'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import { useHealth } from '@/lib/useHealth';
import { getDashboard } from '@/lib/api';
import { DashboardStats } from '@/lib/types';

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[var(--surface)] p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs opacity-60">{label}</span>
    </div>
  );
}

function ItemRow({ item }: { item: { id: string; title: string | null; source_format: string } }) {
  return (
    <a
      href={`/items/${item.id}`}
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
    >
      <span className="min-w-0 flex-1 truncate">{item.title || <span className="opacity-50">Untitled</span>}</span>
      <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase opacity-70">{item.source_format}</span>
    </a>
  );
}

export default function DashboardPage() {
  const { showBanner, check, status } = useHealth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboard().then((s) => { if (!cancelled) setStats(s); }).catch(() => setError('Failed to load dashboard'));
    return () => { cancelled = true; };
  }, []);

  const totals = stats?.totals || {};
  const byFormat = stats?.by_format || {};
  const byBlueprint = stats?.by_blueprint || {};

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>

        <form className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search across everything…"
            className="w-full rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => setCaptureOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black"
          >
            Capture
          </button>
        </form>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        {!stats && !error ? (
          <p className="text-sm opacity-60">Loading dashboard…</p>
        ) : null}

        {stats ? (
          <>
            <Card title="Library overview">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Items" value={totals.items ?? 0} />
                <Stat label="Inbox" value={totals.inbox ?? 0} />
                <Stat label="Segments" value={totals.segments ?? 0} />
                <Stat label="Scanned" value={stats.scanned_segments} />
              </div>
            </Card>

            <Card title="By format">
              {Object.keys(byFormat).length === 0 ? (
                <p className="text-xs opacity-60">Nothing captured yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Object.entries(byFormat).map(([format, count]) => (
                    <Stat key={format} label={format.replace('_', ' ')} value={count} />
                  ))}
                </div>
              )}
            </Card>

            {Object.keys(byBlueprint).length > 0 ? (
              <Card title="By blueprint">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Object.entries(byBlueprint).map(([name, count]) => (
                    <Stat key={name} label={name} value={count} />
                  ))}
                </div>
              </Card>
            ) : null}

            <Card title="Continue reading" action={<a href="/library" className="text-xs opacity-60 hover:opacity-100">Open library</a>}>
              {stats.continue_reading.length === 0 ? (
                <p className="text-xs opacity-60">Nothing in progress.</p>
              ) : (
                <div className="space-y-1">
                  {stats.continue_reading.slice(0, 5).map((item: any, i: number) => (
                    <ItemRow key={i} item={item} />
                  ))}
                </div>
              )}
            </Card>

            <Card title="Recently added">
              {stats.recently_added.length === 0 ? (
                <p className="text-xs opacity-60">No items yet.</p>
              ) : (
                <div className="space-y-1">
                  {stats.recently_added.slice(0, 5).map((item: any, i: number) => (
                    <ItemRow key={i} item={item} />
                  ))}
                </div>
              )}
            </Card>

            {stats.recent_activity.length > 0 ? (
              <Card title="Recent activity">
                <ul className="space-y-2 text-sm">
                  {stats.recent_activity.slice(0, 8).map((entry: any, i: number) => (
                    <li key={i} className="flex gap-2 opacity-80">
                      <span className="shrink-0 text-[10px] uppercase opacity-50">{new Date(entry.created_at).toLocaleDateString()}</span>
                      <span className="min-w-0 truncate">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}

        {captureOpen ? (
          <OmniCaptureModal onClose={() => setCaptureOpen(false)} />
        ) : null}
      </div>
    </Shell>
  );
}
