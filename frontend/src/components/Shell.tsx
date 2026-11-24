'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import OmniCaptureModal from '@/components/OmniCaptureModal';
import {
  CollectionsIcon,
  DashboardIcon,
  LibraryIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StudioIcon,
} from '@/components/icons';
import { getSavedViews, getWorkspaces } from '@/lib/api';
import type { SavedView, Workspace } from '@/lib/types';

type NavItem = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
};

/** One icon set, 20px, one stroke weight — no font glyphs in the chrome. */
const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/library', label: 'Library', Icon: LibraryIcon },
  { href: '/search', label: 'Search', Icon: SearchIcon },
  { href: '/collections', label: 'Collections', Icon: CollectionsIcon },
  { href: '/studio', label: 'Studio', Icon: StudioIcon },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon },
];

/** Phone bar: Dashboard, Library, capture, Search, Settings. */
const LEFT = [NAV[0], NAV[1]];
const RIGHT = [NAV[2], NAV[5]];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [capture, setCapture] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [lenses, setLenses] = useState<SavedView[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>('');

  useEffect(() => {
    Promise.all([getWorkspaces(), getSavedViews(true)])
      .then(([ws, views]) => {
        setWorkspaces(ws);
        setLenses(views);
        const fallback = ws.find((w) => w.is_default) ?? ws[0];
        if (fallback) setActiveWorkspace(fallback.id);
      })
      .catch(() => {
        /* nav still usable without catalog data */
      });
  }, []);

  const focusSearch = useCallback(() => {
    router.push('/search?focus=1');
  }, [router]);

  // Cmd/Ctrl+K jumps to Search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
      }
      if (event.key === 'Escape') setCapture(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] md:flex md:flex-col">
        <div className="px-4 pt-5 pb-3">
          <Link href="/" className="text-sm font-semibold tracking-[0.2em] uppercase">
            Nexus
          </Link>
        </div>

        {workspaces.length > 0 ? (
          <div className="px-4 pb-4">
            <label htmlFor="workspace-switch" className="mb-1 block text-[10px] uppercase text-[var(--text-subtle)]">
              Workspace
            </label>
            <select
              id="workspace-switch"
              value={activeWorkspace}
              onChange={(event) => setActiveWorkspace(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? 'bg-[var(--surface-2)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              <item.Icon className="shrink-0 opacity-90" />
              {item.label}
            </Link>
          ))}
        </nav>

        {lenses.length > 0 ? (
          <div className="mt-5 px-4">
            <p className="mb-2 text-[10px] uppercase text-[var(--text-subtle)]">Pinned lenses</p>
            <ul className="space-y-1">
              {lenses.slice(0, 6).map((lens) => (
                <li key={lens.id}>
                  <Link
                    href={`/library?lens=${lens.id}`}
                    className="block truncate rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  >
                    {lens.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-auto space-y-2 p-4">
          <button
            type="button"
            onClick={focusSearch}
            className="btn-quiet w-full rounded-md px-2 py-1.5 text-left text-xs"
          >
            Quick search <span className="float-right opacity-70">⌘K</span>
          </button>
          <button
            type="button"
            onClick={() => setCapture(true)}
            className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black"
          >
            Capture
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 px-4 pb-[calc(var(--nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)] pt-5 md:px-8 md:pb-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>

      {/* Mobile bottom nav: four destinations plus the centered capture action. */}
      <nav
        aria-label="Primary"
        className="nav-safe fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--border)] bg-[var(--surface)] px-1 pt-1 md:hidden"
      >
        {LEFT.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] ${
              isActive(item.href) ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <item.Icon />
            <span>{item.label}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setCapture(true)}
          aria-label="Capture"
          className="mx-1 flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg shadow-black/30"
        >
          <PlusIcon width={22} height={22} />
        </button>
        {RIGHT.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] ${
              isActive(item.href) ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
            }`}
          >
            <item.Icon />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {capture ? <OmniCaptureModal onClose={() => setCapture(false)} /> : null}
    </div>
  );
}
