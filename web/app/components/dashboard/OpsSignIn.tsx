'use client';

import { useState } from 'react';
import { opsLogin, logout } from '../../lib/api';
import { useSession } from '../../lib/session';

/**
 * Operator gate for the dashboard's fund-moving actions (run a settlement,
 * create a payout batch, assign a SCOUT tier). Those endpoints return 403 to an
 * ordinary driver session, so without this there is no way to drive them from
 * the UI — and no way to tell a permission failure from a bug.
 */
export function OpsSignIn() {
  const { user, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user?.method === 'ops') {
    return (
      <button
        onClick={async () => {
          setSubmitting(true);
          await logout();
          await refresh();
          setSubmitting(false);
        }}
        disabled={submitting}
        title="End the operator session"
        className="group inline-flex items-center gap-2 rounded-full bg-[#03C394]/15 border border-[#03C394]/30 px-4 h-10 text-sm font-medium text-[#04624A] hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-colors duration-200 disabled:opacity-50"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#03C394] group-hover:bg-red-500" />
        <span className="group-hover:hidden">{submitting ? 'Exiting…' : 'Operator'}</span>
        <span className="hidden group-hover:inline">Exit operator</span>
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await opsLogin(passcode);
      await refresh();
      setOpen(false);
      setPasscode('');
    } catch {
      setError('Incorrect passcode.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center rounded-full bg-white border border-black/10 px-4 h-10 text-sm text-black/70 hover:bg-black/[0.02]"
      >
        Ops access
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 top-12 z-30 w-72 rounded-2xl border border-black/5 bg-white p-4 shadow-lg"
        >
          <p className="text-xs text-black/60">
            Settlement, payouts and SCOUT issuance require an operator session.
          </p>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Operator passcode"
            autoFocus
            className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-black/40 focus:outline-none"
          />
          {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={submitting || !passcode}
            className="mt-3 w-full rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/85 disabled:opacity-40"
          >
            {submitting ? 'Checking…' : 'Enter'}
          </button>
        </form>
      )}
    </div>
  );
}
