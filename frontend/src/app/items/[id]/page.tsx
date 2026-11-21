'use client';

import Shell from '@/components/Shell';

export default function ItemPage({ params }: { params: { id: string } }) {
  const id = params.id;
  // Item Inspector arrives in Stage 5B; this placeholder keeps deep links alive.
  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Item</h1>
        <p className="rounded-xl border border-white/10 bg-[var(--surface)] p-4 text-sm">
          Item ID: <span className="font-mono text-xs">{id}</span>
        </p>
        <p className="text-sm opacity-60">
          The Item Inspector (PDF viewer, segment list, triage, links, export) is planned for Stage 5B.
        </p>
      </div>
    </Shell>
  );
}
