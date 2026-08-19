import { LayoutGrid, ArrowLeftRight, Award, Banknote, Landmark, User } from 'lucide-react';

export const SECTIONS = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutGrid,
    description: 'Settlement volume, driver reach and recent on-chain activity.',
  },
  {
    label: 'Settlement',
    href: '/dashboard/settlement',
    icon: ArrowLeftRight,
    description:
      'Deterministic 50 / 30 / 20 revenue split with SCOUT reputation multipliers, drilled down Source → Split → Driver.',
  },
  {
    label: 'SCOUT',
    href: '/dashboard/scout',
    icon: Award,
    description:
      'On-chain reputation tiers as Classic Assets. Tier is assigned from a PulseGen score; the settlement engine reads the badge for the reward multiplier.',
  },
  {
    label: 'Off-ramp',
    href: '/dashboard/offramp',
    icon: Banknote,
    description:
      'Ramp Network off-ramp (sell XLM → fiat, incl. INR). Running against the sandbox stub until a Ramp host API key lands.',
  },
  {
    label: 'Treasury',
    href: '/dashboard/treasury',
    icon: Landmark,
    description:
      'Protocol-governed distribution accounts, multisig configuration and Aquarius liquidity conversion.',
  },
] as const;

export const FOOTER_SECTIONS = [
  {
    label: 'Profile',
    href: '/dashboard/profile',
    icon: User,
    description: 'Your session, sign-in method and linked Stellar account.',
  },
] as const;

const ALL = [...SECTIONS, ...FOOTER_SECTIONS];

export function sectionFor(pathname: string) {
  return (
    ALL.filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)).sort(
      (a, b) => b.href.length - a.href.length,
    )[0] ?? null
  );
}
