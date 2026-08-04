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
      <div className="rounded-2xl bg-white p-6">
        <p className="text-sm text-black/50">Loading…</p>
      </div>
    );
  }

  if (user?.method === 'google') {
    return (
      <div className="rounded-2xl bg-white p-6 space-y-3">
        <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
          Google Login <span className="text-black/40 font-normal">(Custodial)</span>
        </h2>
        <p className="text-sm text-black/70">
          Signed in as <strong>{user.email}</strong>
          <br />
          Public key: <code className="text-xs break-all text-black/50">{user.address}</code>
        </p>
        <button
          onClick={logout}
          className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 space-y-3">
      <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
        Google Login <span className="text-black/40 font-normal">(Custodial)</span>
      </h2>
      <p className="text-sm text-black/60">
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
