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

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function SignInPanel() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [unfundedAddress, setUnfundedAddress] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const googleInitialized = useRef(false);
  const googleHiddenRef = useRef<HTMLDivElement>(null);
  const [googleReady, setGoogleReady] = useState(false);

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

  const initGoogle = useCallback(() => {
    if (googleInitialized.current || !GOOGLE_CLIENT_ID) return;
    if (!window.google || !googleHiddenRef.current) return;
    googleInitialized.current = true;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    // Render Google's real button off-screen. We keep it in the DOM
    // (accessibility + the account-chooser popup it triggers is the
    // reliable path — One Tap's `prompt()` silently no-ops after a
    // few dismissals) and click it programmatically from our own
    // styled button. That way the visible button matches the other
    // two, but the underlying flow is the officially-supported one.
    window.google.accounts.id.renderButton(googleHiddenRef.current, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      width: 240,
    });
    setGoogleReady(true);
  }, [handleCredential]);

  const startGoogle = useCallback(() => {
    if (!googleReady) return;
    setError(null);
    // Google's rendered button lives inside an iframe. Traverse the
    // shadow container to find the actual clickable role="button"
    // element and forward the click. Fallback: click the container.
    const host = googleHiddenRef.current;
    if (!host) return;
    const clickable =
      host.querySelector('div[role="button"]') as HTMLElement | null
      ?? (host.querySelector('div > div > div') as HTMLElement | null)
      ?? host;
    clickable.click();
  }, [googleReady]);

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
          Payments starts here
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
                  onLoad={initGoogle}
                  onReady={initGoogle}
                />
                <button
                  onClick={startGoogle}
                  disabled={pending !== null || !googleReady}
                  className={`${BUTTON_BASE} border border-black/10 bg-white text-black hover:bg-black/5`}
                >
                  <GoogleGlyph />
                  {pending === 'google' ? 'Signing in…' : 'Continue with Google'}
                </button>
                {/* Google's rendered iframe button — kept off-screen but
                    functional. Our styled button above forwards clicks
                    to it. Do NOT display:none; Google's iframe won't
                    hydrate a hidden host. */}
                <div
                  ref={googleHiddenRef}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: -9999,
                    top: -9999,
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />
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

        {error && !/sign in to continue/i.test(error) && (
          <p className="text-sm text-red-600 mt-6 break-all">{error}</p>
        )}
      </div>

      <p className="text-xs text-black/40 text-center">
        By continuing, you agree to our Terms and Privacy Policy.
      </p>
    </div>
  );
}
