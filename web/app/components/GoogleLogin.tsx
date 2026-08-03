'use client';

import Script from 'next/script';
import { useCallback, useRef, useState } from 'react';
import { verifyGoogleIdToken } from '../lib/api';
import { useSession } from '../lib/session';

interface CredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: { theme: string; size: string },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

interface State {
  status: 'idle' | 'loading' | 'error';
  error?: string;
}

export default function GoogleLogin() {
  const { user, loading: sessionLoading, refresh, logout } = useSession();
  const [state, setState] = useState<State>({ status: 'idle' });
  const buttonRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      setState({ status: 'loading' });
      try {
        await verifyGoogleIdToken(response.credential);
        await refresh();
        setState({ status: 'idle' });
      } catch (err) {
        setState({ status: 'error', error: String(err) });
      }
    },
    [refresh],
  );

  const renderButton = useCallback(() => {
    if (initialized.current || !window.google || !buttonRef.current) return;
    initialized.current = true;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
    });
  }, [handleCredential]);

  if (sessionLoading) {
    return (
      <div className="rounded border border-gray-200 p-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (user?.method === 'google') {
    return (
      <div className="rounded border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold">Google Login (Custodial)</h2>
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
      <h2 className="font-semibold">Google Login (Custodial)</h2>
      <p className="text-sm text-gray-600">
        Sign in with Google. We provision and hold a Stellar wallet for you, tied to your
        Google account.
      </p>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={renderButton}
        onReady={renderButton}
      />
      <div ref={buttonRef} />
      {state.status === 'error' && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
