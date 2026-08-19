'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, User as UserIcon } from 'lucide-react';
import type { HealthResponse } from '@pathpulse/contract';
import { getHealth } from '../../lib/api';
import { useSession } from '../../lib/session';
import { sectionFor } from './sections';
import { usePageActionsSlot } from './PageActions';
import { T } from './typography';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const METHOD_LABEL = { google: 'Google', wallet: 'Wallet', guest: 'Guest' } as const;

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const pageActions = usePageActionsSlot();
  const { user, loading, logout } = useSession();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const signOut = useCallback(async () => {
    await logout();
    setOpen(false);
    router.push('/signin');
  }, [logout, router]);

  const label = user
    ? user.email ?? (user.address ? short(user.address) : 'Guest session')
    : 'Not signed in';

  return (
    <header className="shrink-0 flex items-start justify-between gap-6 px-6 pt-6 pb-5">
      <div className="min-w-0 flex-1">
        <h1 className={T.pageTitle}>{section?.label ?? 'Dashboard'}</h1>
        {section?.description && (
          <p className={`${T.pageDescription} mt-1.5 max-w-3xl`}>{section.description}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {pageActions}
        {health ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-black/5 px-4 h-10 text-sm text-black/60">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {health.network} · v{health.version}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-black/5 px-4 h-10 text-sm text-black/40">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            Backend unreachable
          </span>
        )}

      <div className="relative" ref={menuRef}>
        {loading ? (
          <div className="h-10 w-40 rounded-full bg-white border border-black/5" />
        ) : user ? (
          <>
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-3 rounded-full bg-white border border-black/5 h-10 pl-1.5 pr-3 hover:bg-black/[0.02] transition-colors duration-200"
            >
              <span className="w-7 h-7 rounded-full bg-black text-white text-xs font-medium flex items-center justify-center">
                {(user.email ?? user.address ?? 'G').slice(0, 1).toUpperCase()}
              </span>
              <span className="text-sm text-black max-w-[180px] truncate">{label}</span>
              <span className="text-[10px] uppercase tracking-wide rounded-full bg-black/5 text-black/50 px-2 py-0.5">
                {METHOD_LABEL[user.method]}
              </span>
              <ChevronDown className="w-4 h-4 text-black/40" />
            </button>

            {open && (
              <div className="absolute right-0 top-12 w-64 rounded-2xl bg-white border border-black/5 shadow-lg p-2 z-30">
                <div className="px-3 py-2">
                  <p className="text-sm text-black truncate">{label}</p>
                  <p className="text-xs text-black/40 mt-0.5">
                    Signed in with {METHOD_LABEL[user.method]}
                  </p>
                </div>
                <div className="h-px bg-black/5 my-1" />
                <Link
                  href="/dashboard/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-xl px-3 h-10 text-sm text-black/70 hover:bg-black/[0.03] hover:text-black transition-colors duration-200"
                >
                  <UserIcon className="w-4 h-4" />
                  Profile
                </Link>
                {user.method === 'guest' && (
                  <Link
                    href="/signin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 h-10 text-sm text-black/70 hover:bg-black/[0.03] hover:text-black transition-colors duration-200"
                  >
                    <UserIcon className="w-4 h-4" />
                    Sign in properly
                  </Link>
                )}
                <button
                  onClick={signOut}
                  className="w-full flex items-center gap-2 rounded-xl px-3 h-10 text-sm text-black/70 hover:bg-black/[0.03] hover:text-black transition-colors duration-200"
                >
                  <LogOut className="w-4 h-4" />
                  {user.method === 'guest' ? 'Exit guest session' : 'Sign out'}
                </button>
              </div>
            )}
          </>
        ) : (
          <Link
            href="/signin"
            className="flex items-center h-10 px-6 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors duration-200"
          >
            Sign in
          </Link>
        )}
        </div>
      </div>
    </header>
  );
}
