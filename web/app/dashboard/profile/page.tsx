'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useSession } from '../../lib/session';

const METHOD_LABEL = { google: 'Google', wallet: 'Stellar wallet', guest: 'Guest' } as const;

const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, logout } = useSession();

  const signOut = useCallback(async () => {
    await logout();
    router.push('/signin');
  }, [logout, router]);

  if (loading) {
    return <p className="text-sm text-black/50">Loading…</p>;
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-black text-3xl font-medium" style={{ letterSpacing: '-0.03em' }}>
          Profile
        </h1>
        <div className="rounded-2xl bg-white p-6 max-w-xl">
          <p className="text-sm text-black/60 mb-4">You are not signed in.</p>
          <Link
            href="/signin"
            className="inline-flex items-center h-10 px-6 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors duration-200"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-black text-3xl font-medium" style={{ letterSpacing: '-0.03em' }}>
        Profile
      </h1>

      <div className="rounded-2xl bg-white p-6 max-w-xl space-y-5">
        <div className="flex items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-black text-white text-lg font-medium flex items-center justify-center">
            {(user.email ?? user.address ?? 'G').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="text-black font-medium truncate">
              {user.email ?? (user.address ? 'Wallet account' : 'Guest session')}
            </div>
            <div className="text-sm text-black/50">Signed in with {METHOD_LABEL[user.method]}</div>
          </div>
        </div>

        <div className="border-t border-black/5 pt-5 space-y-4">
          <div>
            <div className="text-xs text-black/50">User ID</div>
            <div className="font-mono text-xs text-black/70 mt-1 break-all">{user.userId}</div>
          </div>

          {user.email && (
            <div>
              <div className="text-xs text-black/50">Email</div>
              <div className="text-sm text-black/70 mt-1">{user.email}</div>
            </div>
          )}

          {user.address && (
            <div>
              <div className="text-xs text-black/50">Stellar address</div>
              <a
                href={explorerAcct(user.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-black/70 mt-1 break-all underline hover:text-black transition-colors duration-200 block"
              >
                {user.address}
              </a>
            </div>
          )}
        </div>

        <div className="border-t border-black/5 pt-5 flex flex-wrap gap-3">
          {user.method === 'guest' && (
            <Link
              href="/signin"
              className="inline-flex items-center h-10 px-6 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors duration-200"
            >
              Sign in with wallet or Google
            </Link>
          )}
          <button
            onClick={signOut}
            className="inline-flex items-center h-10 px-6 rounded-full border border-black/10 text-sm hover:bg-black/5 transition-colors duration-200"
          >
            {user.method === 'guest' ? 'Exit guest session' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
