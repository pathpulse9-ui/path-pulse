'use client';

import { useCallback, useState } from 'react';
import { requestMagicLink } from '../lib/api';
import { useSession } from '../lib/session';

interface State {
  status: 'idle' | 'loading' | 'sent' | 'error';
  devLink?: string;
  error?: string;
}

export default function EmailLogin() {
  const { user, loading: sessionLoading, logout } = useSession();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setState({ status: 'loading' });
      try {
        const { devLink } = await requestMagicLink(email);
        setState({ status: 'sent', devLink });
      } catch (err) {
        setState({ status: 'error', error: String(err) });
      }
    },
    [email],
  );

  if (sessionLoading) {
    return (
      <div className="rounded border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (user?.method === 'email') {
    return (
      <div className="rounded border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold">Email Login (Custodial)</h2>
        <p className="text-sm text-green-700">
          Signed in as <strong>{user.email}</strong>
          <br />
          Public key: <code className="text-xs break-all">{user.address}</code>
        </p>
        <button
          onClick={logout}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 p-4 space-y-3">
      <h2 className="font-semibold">Email Login (Custodial)</h2>
      <p className="text-sm text-gray-600">
        We&apos;ll email you a sign-in link. We provision and hold a Stellar wallet for you, tied
        to your email.
      </p>
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={state.status === 'loading'}
          className="rounded bg-black px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
        >
          {state.status === 'loading' ? 'Sending…' : 'Send magic link'}
        </button>
      </form>
      {state.status === 'sent' && (
        <div className="text-sm text-green-700 space-y-1">
          <p>Check your email for a sign-in link.</p>
          {state.devLink && (
            <p className="text-amber-700">
              DEV ONLY (no email provider wired):{' '}
              <a href={state.devLink} className="underline break-all">
                {state.devLink}
              </a>
            </p>
          )}
        </div>
      )}
      {state.status === 'error' && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
