'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import { ChevronRightIcon } from '@/components/icons';
import { DurationLabel, FormatPill } from '@/components/ui/badges';
import { getDashboard } from '@/lib/api';
import { countParts, formatLabel, relativeTime, resumeLabel } from '@/lib/format';
import { useLiveData } from '@/lib/sync';
import type { ActivityLog, DashboardStats, Item } from '@/lib/types';

function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ${className}`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums leading-tight text-[var(--text)]">{value}</p>
      <p className="text-[11px] text-[var(--text-subtle)]">{label}</p>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
      {children}
    </span>
  );
}

/** Collapse consecutive activity rows that say the same thing. */
type ActivityRow = ActivityLog & { repeats: number };

function collapseActivity(entries: ActivityLog[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const entry of entries) {
    const previous = rows[rows.length - 1];
    if (previous && previous.kind === entry.kind && previous.message === entry.message) {
      previous.repeats += 1;
      previous.created_at = entry.created_at;
      continue;
    }
    rows.push({ ...entry, repeats: 1 });
  }
  return rows;
}

/**
 * The message for item events repeats the title ("Captured pdf item: Influence…").
 * When the title is already on screen, label the event instead of repeating it.
 */
function activityNote(entry: ActivityLog, titleKnown: boolean): string {
  if (!titleKnown) return entry.message;
  const short: Record<string, string> = {
    'item.created': 'Captured',
    'item.updated': 'Edited',
    'item.deleted': 'Deleted',
    'item.reindexed': 'Re-indexed',
    'link.created': 'Linked',
    'link.deleted': 'Unlinked',
  };
  if (short[entry.kind]) return short[entry.kind];
  if (entry.kind === 'item.triage') return entry.message.replace('->', '→');
  return formatLabel(entry.kind.replace('.', ' '));
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [capture, setCapture] = useState(false);

  const load = useCallback(() => {
    getDashboard()
      .then((res) => {
        setStats(res);
        setError('');
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Dashboard unavailable')
      );
  }, []);

  useEffect(load, [load]);
  // Counters and lists refresh as soon as a capture or triage change lands.
  useLiveData(load);

  const totals = stats?.totals ?? {};

  const titles = new Map<string, Item>();
  for (const item of [...(stats?.continue_reading ?? []), ...(stats?.recently_added ?? [])]) {
    titles.set(item.id, item);
  }

  const formats = Object.entries(stats?.by_format ?? {}).filter(([, count]) => count > 0);
  const blueprints = Object.entries(stats?.by_blueprint ?? {}).filter(([, count]) => count > 0);
  const integrity = stats
    ? countParts([
        { count: stats.scanned_segments, singular: 'scanned segment' },
        { count: stats.failed_extractions, singular: 'failed extraction' },
      ])
    : '';

  const activity = collapseActivity((stats?.recent_activity ?? []).slice(0, 12)).slice(0, 6);

  return (
    <Shell>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          {/* Phone has the centered + in the bottom bar; keep the desktop button. */}
          <button
            type="button"
            onClick={() => setCapture(true)}
            className="btn-primary hidden rounded-lg px-3 py-1.5 text-xs font-medium md:inline-block"
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
          <button
            type="submit"
            className="btn-primary shrink-0 rounded-lg px-3 text-xs font-medium"
          >
            Go
          </button>
        </form>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : null}

        {!stats && !error ? (
          <p className="text-sm text-[var(--text-subtle)]">Loading…</p>
        ) : null}

        {stats ? (
          <>
            {/* One summary card: four numbers plus inline format/blueprint chips,
                so Continue reading and Recently added sit near the top on a phone. */}
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="grid grid-cols-4 gap-3">
                <Figure label="Items" value={totals.items ?? 0} />
                <Figure label="Inbox" value={totals.inbox ?? 0} />
                <Figure label="Reading" value={totals.reading ?? 0} />
                <Figure label="Segments" value={totals.segments ?? 0} />
              </div>

              {formats.length > 0 || blueprints.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
                  {formats.map(([format, count]) => (
                    <Chip key={format}>
                      {formatLabel(format)} {count}
                    </Chip>
                  ))}
                  {blueprints.length > 0 ? <span className="mx-0.5 h-3 w-px bg-[var(--border)]" /> : null}
                  {blueprints.map(([name, count]) => (
                    <Chip key={name}>
                      {formatLabel(name)} {count}
                    </Chip>
                  ))}
                </div>
              ) : null}

              {integrity ? (
                <p className="mt-2 text-[11px] text-amber-300">{integrity}</p>
              ) : null}
            </section>

            <Panel
              title="Continue reading"
              action={
                <Link
                  href="/library"
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Library →
                </Link>
              }
            >
              {stats.continue_reading.length === 0 ? (
                <p className="text-xs text-[var(--text-subtle)]">Nothing in progress.</p>
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {stats.continue_reading.map((item) => {
                    const segment = Number(item.reading_progress?.segment_index ?? 0);
                    return (
                      <li key={item.id}>
                        <Link
                          href={`/items/${item.id}${segment ? `?segment=${segment}` : ''}`}
                          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-2)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[var(--text)]">{item.title}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-subtle)]">
                              <span>{resumeLabel(item.source_format, segment)}</span>
                              <DurationLabel minutes={item.est_read_minutes} />
                            </span>
                          </span>
                          {segment ? (
                            <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text)]">
                              Resume · {resumeLabel(item.source_format, segment)}
                            </span>
                          ) : null}
                          <ChevronRightIcon className="shrink-0 text-[var(--text-subtle)]" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Recently added">
              {stats.recently_added.length === 0 ? (
                <p className="text-xs text-[var(--text-subtle)]">No items yet.</p>
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {stats.recently_added.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/items/${item.id}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <DurationLabel
                          minutes={item.est_read_minutes}
                          className="shrink-0 text-[11px] text-[var(--text-subtle)]"
                        />
                        <FormatPill format={item.source_format} className="shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {activity.length > 0 ? (
              <Panel title="Recent activity">
                <ul className="-mx-2 space-y-0.5 text-xs">
                  {activity.map((entry) => {
                    const item = entry.item_id ? titles.get(entry.item_id) : undefined;
                    return (
                      <li
                        key={entry.id}
                        className="flex items-baseline gap-2 rounded-lg px-2 py-1 text-[var(--text-muted)]"
                      >
                        <span className="min-w-0 flex-1">
                          {item ? (
                            <Link
                              href={`/items/${item.id}`}
                              className="block truncate text-[var(--text)] hover:underline"
                            >
                              {item.title}
                            </Link>
                          ) : null}
                          <span className="block truncate">{activityNote(entry, Boolean(item))}</span>
                        </span>
                        {entry.repeats > 1 ? (
                          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] text-[var(--text-subtle)]">
                            ×{entry.repeats}
                          </span>
                        ) : null}
                        <time
                          dateTime={entry.created_at}
                          className="shrink-0 text-[10px] text-[var(--text-subtle)]"
                          title={new Date(entry.created_at).toLocaleString()}
                        >
                          {relativeTime(entry.created_at)}
                        </time>
                      </li>
                    );
                  })}
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
