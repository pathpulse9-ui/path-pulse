import Link from 'next/link';
import { LogoIcon } from './LogoIcon';

const NAV_LINKS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Settlement Engine', href: '/dashboard/settlement' },
  { label: 'Off-ramp', href: '/dashboard/offramp' },
  { label: 'Docs', href: '#' },
  { label: 'Partners', href: '#' },
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
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-base text-gray-700 hover:text-black font-medium transition-colors duration-200"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Link
          href="/signin"
          className="bg-black text-white text-base font-medium px-7 py-2.5 rounded-full hover:bg-gray-800 transition-colors duration-200"
        >
          Sign in
        </Link>
      </div>
    </nav>
  );
}
