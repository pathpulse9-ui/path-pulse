import Link from 'next/link';
import type { Metadata } from 'next';
import { STELLAR_NETWORK } from '../lib/network';

export const metadata: Metadata = {
  title: 'PathPulse — Government Dashboard',
  description:
    'Institutional transparency layer for PathPulse settlements. Every rupee traceable from treasury deposit to driver payout, verifiable on Stellar.',
};

export default function GovLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F3F7F5] text-black">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/gov" className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[#03C394] text-white">
              <span className="text-sm font-bold">P</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">PathPulse</div>
              <div className="text-[11px] uppercase tracking-wide text-black/50">Gov Dashboard</div>
            </div>
          </Link>
          <nav className="order-last flex w-full items-center gap-5 text-sm text-black/70 sm:order-none sm:w-auto">
            <Link href="/gov" className="hover:text-black">Overview</Link>
            <Link href="/gov/settlements" className="hover:text-black">Settlements</Link>
            <Link href="/gov/audit" className="hover:text-black">Audit trail</Link>
          </nav>
          <div className="ml-auto">
            <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-medium tracking-wide text-black/60">
              {STELLAR_NETWORK.toUpperCase()}
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-6 text-xs text-black/40 sm:px-6">
        Every settlement above is a Stellar transaction. Verify any hash at{' '}
        <a href="https://stellar.expert" className="underline hover:text-black/70">
          stellar.expert
        </a>{' '}
        or Horizon directly.
      </footer>
    </div>
  );
}
