'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSession, unlockSession } from '@/lib/api';

/**
 * Single-user passcode gate.
 *
 * `/api/v1/auth/session` never raises: it reports `dev_open` when
 * NEXUS_ACCESS_KEY is unset, otherwise `locked` until the cookie exists. This
 * component mirrors that decision, so a deployment without a passcode opens
 * straight into the app while a locked one shows the unlock form.
 */
export default function PasscodeGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const session = await getSession();
      setUnlocked(session.authenticated || session.mode === 'dev_open');
    } catch {
      // Backend asleep or down: WakeBanner explains it; do not lock the user out.
      setUnlocked(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await unlockSession(passcode.trim());
      if (session.authenticated) {
        setUnlocked(true);
        setPasscode('');
      } else {
        setError('That passcode was not accepted.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return <p className="px-6 py-16 text-center text-sm opacity-60">Checking session…</p>;
  }

  if (unlocked) return <>{children}</>;

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-lg font-semibold tracking-tight">NEXUS</h1>
      <p className="mt-1 text-sm opacity-60">Enter the passcode to unlock this library.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label htmlFor="passcode" className="sr-only">
          Passcode
        </label>
        <input
          id="passcode"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="Passcode"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        {error ? <p className="text-xs text-[var(--danger,#e0798f)]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
