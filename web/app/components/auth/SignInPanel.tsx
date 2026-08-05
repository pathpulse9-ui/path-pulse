'use client';

import Script from 'next/script';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogoIcon } from '../landing/LogoIcon';
import { StellarWalletsKit, initKit, FRIENDBOT_URL } from '../../lib/stellar';
import {
  getWalletChallenge,
  verifyWalletChallenge,
  verifyGoogleIdToken,
  continueAsGuest,
} from '../../lib/api';
import { useSession } from '../../lib/session';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const AFTER_SIGN_IN = '/dashboard';

interface CredentialResponse {
  credential: string;
}

type Pending = 'wallet' | 'google' | 'guest' | null;

const BUTTON_BASE =
  'h-12 w-full rounded-full text-sm font-medium flex items-center justify-center gap-3 transition-colors duration-200 disabled:opacity-50';

export default function SignInPanel() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [unfundedAddress, setUnfundedAddress] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitialized = useRef(false);

  useEffect(() => {
    initKit();
  }, []);

  const finish = useCallback(async () => {
    await refresh();
    router.push(AFTER_SIGN_IN);
  }, [refresh, router]);

  const connectWallet = useCallback(async () => {
    setPending('wallet');
    setError(null);
    setUnfundedAddress(null);
    let address: string | undefined;
    try {
      ({ address } = await StellarWalletsKit.authModal());
      const { transaction, networkPassphrase } = await getWalletChallenge(address);
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(transaction, {
        address,
        networkPassphrase,
      });
      await verifyWalletChallenge(signedTxXdr);
      await finish();
    } catch (e) {
      setError(String(e));
      if (address) setUnfundedAddress(address);
    } finally {
      setPending(null);
    }
  }, [finish]);

  const fundAndRetry = useCallback(async () => {
    if (!unfundedAddress) return;
    setFunding(true);
    setError(null);
    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(unfundedAddress)}`);
      if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
      setUnfundedAddress(null);
      await connectWallet();
    } catch (e) {
      setError(String(e));
    } finally {
      setFunding(false);
    }
  }, [unfundedAddress, connectWallet]);

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      setPending('google');
      setError(null);
      try {
        await verifyGoogleIdToken(response.credential);
        await finish();
      } catch (e) {
        setError(String(e));
      } finally {
        setPending(null);
      }
    },
    [finish],
  );

  const renderGoogleButton = useCallback(() => {
    if (googleInitialized.current || !GOOGLE_CLIENT_ID) return;
    if (!window.google || !googleButtonRef.current) return;
    googleInitialized.current = true;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
    });
  }, [handleCredential]);

  const startGuest = useCallback(async () => {
    setPending('guest');
    setError(null);
    try {
      await continueAsGuest();
      await finish();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(null);
    }
  }, [finish]);

  return (
    <div className="flex flex-col justify-between min-h-screen bg-[#F5F5F5] px-8 py-10 lg:px-16">
      <Link href="/" className="flex items-center gap-2 self-start">
        <LogoIcon className="w-7 h-7 text-black" />
        <span className="text-2xl font-medium tracking-tight text-black">PathPulse</span>
      </Link>

      <div className="w-full max-w-sm mx-auto py-16">
        <h1
          className="text-black text-4xl md:text-5xl font-medium leading-tight mb-3"
          style={{ letterSpacing: '-0.04em' }}
        >
          Settlement starts here
        </h1>
        <p className="text-black/60 text-base mb-10">
          Connect a wallet to sign in, or browse the console as a guest.
        </p>

        {loading ? (
          <p className="text-sm text-black/50">Loading…</p>
        ) : user ? (
          <div className="space-y-4">
            <p className="text-sm text-black/70">
              Already signed in
              {user.method === 'guest' ? ' as a guest' : user.email ? ` as ${user.email}` : ''}.
            </p>
            <Link
              href={AFTER_SIGN_IN}
              className={`${BUTTON_BASE} bg-black text-white hover:bg-gray-800`}
            >
              Open console
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={connectWallet}
              disabled={pending !== null}
              className={`${BUTTON_BASE} bg-black text-white hover:bg-gray-800`}
            >
              {pending === 'wallet' ? 'Connecting…' : 'Connect Wallet'}
            </button>

            {GOOGLE_CLIENT_ID ? (
              <>
                <Script
                  src="https://accounts.google.com/gsi/client"
                  strategy="afterInteractive"
                  onLoad={renderGoogleButton}
                  onReady={renderGoogleButton}
                />
                <div ref={googleButtonRef} className="flex justify-center [&>div]:w-full" />
              </>
            ) : (
              <button
                disabled
                title="Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google sign-in"
                className={`${BUTTON_BASE} border border-black/10 text-black/40`}
              >
                Continue with Google — not configured
              </button>
            )}

            <button
              onClick={startGuest}
              disabled={pending !== null}
              className={`${BUTTON_BASE} border border-black/10 text-black hover:bg-black/5`}
            >
              {pending === 'guest' ? 'Starting…' : 'Continue as Guest'}
            </button>

            <p className="text-xs text-black/40 pt-2 text-center">
              Guests get read-only access — no wallet, no payouts, no off-ramp.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-6 break-all">{error}</p>}
      </div>

      <p className="text-xs text-black/40 text-center">
        By continuing, you agree to our Terms and Privacy Policy.
      </p>
    </div>
  );
}
