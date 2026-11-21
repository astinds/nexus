'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/useTheme';
import { useHealth } from '@/lib/useHealth';

export default function Shell({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  const { status } = useHealth();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setMobile(!mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Desktop Sidebar */}
      {!mobile && (
        <aside className="hidden md:block w-64 bg-[var(--surface)] text-[var(--font-reading)] min-h-screen">
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-sm font-medium mb-2">Workspace</h2>
              <div className="flex items-center gap-2">
                <input type="text" placeholder="Search workspaces..." className="rounded-l px-3 py-2 w-32" />
                <button className="rounded-r bg-[var(--accent)] text-white px-3 py-2">+ New</button>
              </div>
            </div>
            <div className="mb-4">
              <h2 className="text-sm font-medium mb-2">Smart Lenses</h2>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="rounded bg-[var(--surface)] p-3 text-sm">Lens {i + 1}</div>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <h2 className="text-sm font-medium mb-2">Quick Search</h2>
              <input type="text" placeholder="Cmd/Ctrl+K to search..." className="w-full rounded-lg px-3 py-2 border border-white/10 bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
            </div>
            <div className="p-4">
              <button className="w-full rounded-lg bg-[var(--accent)] text-white px-3 py-2.5 text-sm font-medium" onClick={() => (window.location.href = '/capture')}>
                Omni-Capture
              </button>
            </div>
          </div>
        </aside>
      )}

      <main className="flex-1 p-4 pb-24 md:pb-4">{children}</main>

      {/* Mobile Bottom Nav */}
      {mobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-[var(--surface)] p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <input type="text" placeholder="Workspace..." className="rounded-l px-3 py-2 w-32" />
            </div>
            <button className="rounded-r bg-[var(--accent)] text-white px-3 py-2">+ New</button>
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded bg-[var(--surface)] p-2 text-sm">Lens {i + 1}</div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Cmd/Ctrl+K to search..." className="w-48 rounded-lg px-3 py-2 border border-white/10 bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          </div>
          <button className="w-full rounded-lg bg-[var(--accent)] text-white px-3 py-2.5 text-sm font-medium" onClick={() => (window.location.href = '/capture')}>
            Omni-Capture
          </button>
        </nav>
      )}
    </div>
  );
}
