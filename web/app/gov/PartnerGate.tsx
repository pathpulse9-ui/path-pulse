'use client';

import { useEffect, useState } from 'react';
import { getSessionUser, partnerLogin } from '../lib/api';

/**
 * Partner access gate for the Government Settlement Gateway (D8).
 *
 * Session is server-verified via the httpOnly `pathpulse_session` cookie
 * (`/v1/auth/partner/login` sets it, `/v1/auth/me` reads it) — the passcode
 * itself is never persisted client-side.
 */
export function PartnerGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'authed' | 'locked'>('checking');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { user } = await getSessionUser();
        setStatus(user?.method === 'partner' ? 'authed' : 'locked');
      } catch {
        setStatus('locked');
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await partnerLogin(passcode);
      setStatus('authed');
    } catch {
      setError('Incorrect passcode.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'checking') {
    return <div className="py-24 text-center text-sm text-black/40">Checking access…</div>;
  }

  if (status === 'locked') {
    return (
      <div className="mx-auto max-w-sm py-24">
        <div className="rounded-3xl bg-white p-8">
          <div className="text-lg font-semibold">Partner sign-in</div>
          <p className="mt-2 text-sm text-black/60">
            This dashboard is restricted to government and ecosystem partners. Enter the
            passcode issued to you.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-black/40 focus:outline-none"
              autoFocus
            />
            {error && <div className="text-sm text-red-700">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !passcode}
              className="w-full rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40"
            >
              {submitting ? 'Checking…' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
