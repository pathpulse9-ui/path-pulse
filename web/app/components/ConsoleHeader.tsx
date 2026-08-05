import Link from 'next/link';
import { LogoIcon } from './landing/LogoIcon';

const CONSOLE_LINKS = [
  { label: 'Wallet', href: '/wallet' },
  { label: 'Settlement', href: '/settlement' },
  { label: 'SCOUT', href: '/scout' },
  { label: 'Off-ramp', href: '/offramp' },
];

export function ConsoleHeader({ active }: { active: 'wallet' | 'settlement' | 'scout' | 'offramp' }) {
  return (
    <header className="px-6 py-5 flex items-center justify-between flex-wrap gap-4">
      <Link href="/" className="flex items-center gap-2">
        <LogoIcon className="w-7 h-7 text-black" />
        <span className="text-2xl font-medium tracking-tight text-black">PathPulse</span>
      </Link>
      <div className="flex items-center gap-6">
        {CONSOLE_LINKS.map((link) => {
          const isActive = link.href === `/${active}`;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                isActive
                  ? 'text-base text-black font-medium'
                  : 'text-base text-gray-700 hover:text-black font-medium transition-colors duration-200'
              }
            >
              {link.label}
            </Link>
          );
        })}
        <Link
          href="/"
          className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
        >
          Back to home
        </Link>
      </div>
    </header>
  );
}
