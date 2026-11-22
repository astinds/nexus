'use client';

import Link from 'next/link';
import type { Item } from '@/lib/types';

/** Cards or compact table — the same data, two densities. */
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
              className="block h-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--accent)]/60"
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase opacity-50">
                <span>{item.source_format.replace(/_/g, ' ')}</span>
                <span>{item.est_read_minutes} min</span>
              </div>
              <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-[11px] opacity-50">
                {item.triage_status.replace(/_/g, ' ')}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--surface)] text-[10px] uppercase opacity-60">
          <tr>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Format</th>
            <th className="px-3 py-2 font-medium">Triage</th>
            <th className="px-3 py-2 font-medium">Min</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-[var(--border)]">
              <td className="max-w-[280px] truncate px-3 py-2">
                <Link href={`/items/${item.id}`}>{item.title}</Link>
              </td>
              <td className="px-3 py-2 text-xs opacity-60">{item.source_format}</td>
              <td className="px-3 py-2 text-xs opacity-60">{item.triage_status}</td>
              <td className="px-3 py-2 text-xs opacity-60">{item.est_read_minutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
