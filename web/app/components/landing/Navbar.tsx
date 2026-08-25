import Link from 'next/link';
import { LogoIcon } from './LogoIcon';

const NAV_ITEMS = [
  {
    label: 'Settlement',
    info: 'Revenue is split 50 / 30 / 20 — Authorities, Driver Rewards, Treasury — computed in exact stroops and settled as one Stellar transaction.',
  },
  {
    label: 'SCOUT',
    info: 'Reputation tiers issued as Classic Assets. A driver’s badge is read on-chain at settlement time and multiplies their share by 1.0×, 1.2× or 1.5×.',
  },
  {
    label: 'Liquidity',
    info: 'Aquarius AMM routing converts between assets before a payout run, quoting the full pool path and a slippage floor enforced on-chain.',
  },
  {
    label: 'Off-ramp',
    info: 'Settled value exits to fiat through a hosted provider that runs KYC, conversion and bank payout — reconciled back to the batch that funded it.',
  },
  {
    label: 'Treasury',
    info: 'Distribution accounts sit behind a multisig signer set with a 2-of-3 threshold. Mainnet actions are never auto-signed.',
  },
];

export function Navbar() {
  return (
    <nav className="absolute top-0 left-0 right-0 z-20 px-6 py-5">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <LogoIcon className="w-7 h-7 text-black" />
          <span className="text-2xl font-medium tracking-tight text-black">PathPulse</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {NAV_ITEMS.map((item) => (
            <div key={item.label} className="relative group">
              <button
                type="button"
                aria-describedby={`nav-info-${item.label}`}
                className="cursor-help text-base text-gray-700 group-hover:text-black font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-black rounded"
              >
                {item.label}
              </button>
              <span
                id={`nav-info-${item.label}`}
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-30 mt-3 w-72 -translate-x-1/2 rounded-2xl bg-white p-4 text-sm leading-relaxed text-black/70 opacity-0 shadow-lg ring-1 ring-black/5 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                {item.info}
              </span>
            </div>
          ))}
        </div>

        <Link
          href="/signin"
          className="bg-black text-white text-base font-medium px-7 py-2.5 rounded-full hover:bg-gray-800 transition-colors duration-200"
        >
          Try it Free
        </Link>
      </div>
    </nav>
  );
}
