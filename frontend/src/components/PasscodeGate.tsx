'use client';

/**
 * Passcode lock screen. Wired to /api/v1/auth/session.
 * Auto-bypassed when backend reports open dev mode.
 */

import { useCallback, useEffect, useState } from 'react';
import { getSession, unlockSession } from '@/lib/api';

interface PasscodeGateProps {
  children: React.ReactNode;
  healthAuthMode?: 'dev_open' | 'passcode' | null;
}

export default function PasscodeGate({ children, healthAuthMode }: PasscodeGateProps) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [mode, setMode] = useState<string>('locked');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const session = await getSession();
      setAuthenticated(session.authenticated || session.mode === 'dev_open');
      setMode(session.mode);
    } catch {
      // Backend unreachable: let the wake banner handle it, show gate anyway.
      setAuthenticated(false);
      setMode('locked');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const session = await unlockSession();
      if (session.authenticated) {
        setAuthenticated(true);
        setMode(session.mode);
      } else {
        setError('Incorrect passcode.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    }
  };

  if (checking) {
    return <div className="flex items-center justify-center py-24 text-sm">Checking session…</div>;
  }

  if (authenticated || mode === 'dev_open' || healthAuthMode === 'dev_open') {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-20">
      <h1 className="text-lg font-semibold tracking-tight">NEXUS</h1>
      <p className="mt-1 text-sm opacity-60">Enter the passcode to unlock.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="password"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Passcode"
          className="w-full rounded-lg border border-white/10 bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
