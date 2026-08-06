'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutGrid,
  ArrowLeftRight,
  Award,
  Banknote,
  Landmark,
  User,
  ChevronsLeft,
} from 'lucide-react';
import { LogoIcon } from '../landing/LogoIcon';

const NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
  { label: 'Settlement', href: '/dashboard/settlement', icon: ArrowLeftRight },
  { label: 'SCOUT', href: '/dashboard/scout', icon: Award },
  { label: 'Off-ramp', href: '/dashboard/offramp', icon: Banknote },
  { label: 'Treasury', href: '/dashboard/treasury', icon: Landmark },
];

const FOOTER_NAV = [{ label: 'Profile', href: '/dashboard/profile', icon: User }];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const renderItem = ({
    label,
    href,
    icon: Icon,
  }: {
    label: string;
    href: string;
    icon: typeof LayoutGrid;
  }) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        className={`relative flex items-center gap-3 h-11 rounded-xl px-3 text-sm transition-colors duration-200 ${
          active ? 'bg-black/5 text-black font-medium' : 'text-black/60 hover:text-black hover:bg-black/[0.03]'
        }`}
      >
        {active && <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-full bg-black" />}
        <Icon className="w-[18px] h-[18px] shrink-0" />
        {!collapsed && <span className="whitespace-nowrap">{label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={`hidden lg:flex flex-col shrink-0 bg-white border-r border-black/5 transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-[248px]'
      }`}
    >
      <Link href="/" className="flex items-center gap-2 h-[72px] px-5 shrink-0">
        <LogoIcon className="w-7 h-7 text-black shrink-0" />
        {!collapsed && (
          <span className="text-xl font-medium tracking-tight text-black">PathPulse</span>
        )}
      </Link>

      <nav className="flex flex-col gap-1 px-3 pt-2">{NAV.map(renderItem)}</nav>

      <div className="mx-5 my-4 h-px bg-black/5" />

      <nav className="flex flex-col gap-1 px-3">{FOOTER_NAV.map(renderItem)}</nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        className="mt-auto flex items-center gap-3 h-11 mx-3 mb-4 rounded-xl px-3 text-sm text-black/50 hover:text-black hover:bg-black/[0.03] transition-colors duration-200"
      >
        <ChevronsLeft
          className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
            collapsed ? 'rotate-180' : ''
          }`}
        />
        {!collapsed && <span className="whitespace-nowrap">Collapse sidebar</span>}
      </button>
    </aside>
  );
}
