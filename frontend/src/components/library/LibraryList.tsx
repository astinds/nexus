'use client';

import Link from 'next/link';
import { DurationLabel, FormatPill, TriageBadge } from '@/components/ui/badges';
import { plural } from '@/lib/format';
import type { Item } from '@/lib/types';

/**
 * Cards or compact table — the same data, two densities.
 *
 * Both layouts read their labels from lib/format and their colours from the
 * badge classes, so a format never appears as "web article" in one view and
 * "web_article" in the other, and triage never renders as dim lowercase text.
 */
export default function LibraryList({
  items,
  layout,
}: {
  items: Item[];
  layout: 'cards' | 'table';
}) {
  if (layout === 'cards') {
    return (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/items/${item.id}`}
              className="block h-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent-ring)]"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <FormatPill format={item.source_format} />
                <DurationLabel
                  minutes={item.est_read_minutes}
                  className="text-[11px] text-[var(--text-subtle)]"
                />
              </div>
              <p className="line-clamp-2 text-sm font-medium text-[var(--text)]">{item.title}</p>
              <div className="mt-2 flex items-center gap-2">
                <TriageBadge status={item.triage_status} />
                <span className="text-[11px] text-[var(--text-subtle)]">
                  {plural(item.word_count, 'word')}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      {/* table-fixed with real column widths: the title column gets the space it
          needs and wraps at word boundaries instead of being clipped mid-word. */}
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col />
          <col className="w-[92px]" />
          <col className="w-[104px]" />
          <col className="w-[72px]" />
        </colgroup>
        <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--text-subtle)]">
          <tr>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-2 py-2 font-medium">Format</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-[var(--border)] align-top">
              <td className="px-3 py-2">
                <Link
                  href={`/items/${item.id}`}
                  className="line-clamp-2 break-words text-[var(--text)] hover:underline"
                >
                  {item.title}
                </Link>
              </td>
              <td className="px-2 py-2">
                <FormatPill format={item.source_format} />
              </td>
              <td className="px-2 py-2">
                <TriageBadge status={item.triage_status} />
              </td>
              <td className="px-2 py-2 text-right text-[11px] text-[var(--text-subtle)]">
                <DurationLabel minutes={item.est_read_minutes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
