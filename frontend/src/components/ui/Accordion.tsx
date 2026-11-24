'use client';

/**
 * Collapsible section built on native <details>/<summary>.
 *
 * Native disclosure gives keyboard support, find-in-page and correct AT roles
 * for free, so Settings needs no state machine to feel calmer. The chevron is
 * the only decoration and it rotates through CSS (`details[open] .accordion-chevron`).
 */

import type { ReactNode } from 'react';
import { ChevronDownIcon } from '@/components/icons';

export default function Accordion({
  title,
  summary,
  children,
  defaultOpen = false,
  className = '',
}: {
  title: string;
  /** Always-visible line beside the title, e.g. the live health status. */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={`accordion rounded-xl border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      <summary className="accordion-summary flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
          {title}
        </span>
        {summary ? <span className="min-w-0 flex-1 text-[11px]">{summary}</span> : <span className="flex-1" />}
        <ChevronDownIcon className="accordion-chevron shrink-0 text-[var(--text-subtle)]" />
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}
