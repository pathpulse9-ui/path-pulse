import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PathPulse — Government Dashboard',
  description:
    'Institutional transparency layer for PathPulse settlements. Every rupee traceable from treasury deposit to driver payout, verifiable on Stellar.',
};

/**
 * D8 Government Dashboard shell — deliberately spartan.
 *
 * No sidebar, no auth wall in v1 (public transparency by design). A slim
 * top strip carries the wordmark + section links and a "TESTNET" badge so
 * regulators can tell they're not on mainnet.
 */
export default function GovLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F3F7F5] text-black">
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-6 py-4">
          <Link href="/gov" className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[#03C394] text-white">
              <span className="text-sm font-bold">P</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">PathPulse</div>
              <div className="text-[11px] uppercase tracking-wide text-black/50">Gov Dashboard</div>
            </div>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-black/70">
            <Link href="/gov" className="hover:text-black">Overview</Link>
            <Link href="/gov/settlements" className="hover:text-black">Settlements</Link>
            <Link href="/gov/audit" className="hover:text-black">Audit trail</Link>
          </nav>
          <div className="ml-auto">
            <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-medium tracking-wide text-black/60">
              TESTNET
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-7xl px-6 pb-10 pt-6 text-xs text-black/40">
        Every settlement above is a Stellar transaction. Verify any hash at{' '}
        <a href="https://stellar.expert" className="underline hover:text-black/70">
          stellar.expert
        </a>{' '}
        or Horizon directly.
      </footer>
    </div>
  );
}
