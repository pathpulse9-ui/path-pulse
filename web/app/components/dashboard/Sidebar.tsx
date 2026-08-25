'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ChevronsLeft, type LucideIcon } from 'lucide-react';
import { LogoIcon } from '../landing/LogoIcon';
import { SECTIONS, FOOTER_SECTIONS } from './sections';

const NAV = SECTIONS;
const FOOTER_NAV = FOOTER_SECTIONS;

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
    icon: LucideIcon;
  }) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        className={`relative flex items-center h-11 rounded-xl text-sm transition-colors duration-200 ${
          collapsed ? 'justify-center' : 'gap-3 px-3'
        } ${
          active ? 'bg-black/5 text-black font-medium' : 'text-black/60 hover:text-black hover:bg-black/[0.03]'
        }`}
      >
        {active && !collapsed && (
          <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-full bg-black" />
        )}
        <Icon className="w-[18px] h-[18px] shrink-0" />
        {!collapsed && <span className="whitespace-nowrap">{label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen bg-white border-r border-black/5 transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-[210px]'
      }`}
    >
      <Link
        href="/"
        className={`flex items-center h-[72px] shrink-0 ${
          collapsed ? 'justify-center' : 'gap-2 px-5'
        }`}
      >
        <LogoIcon className="w-7 h-7 text-black shrink-0" />
        {!collapsed && (
          <span className="text-xl font-medium tracking-tight text-black">PathPulse</span>
        )}
      </Link>

      <nav className="flex flex-col gap-1 px-3 pt-2">{NAV.map(renderItem)}</nav>

      <div className={`my-4 h-px bg-black/5 ${collapsed ? 'mx-3' : 'mx-5'}`} />

      <nav className="flex flex-col gap-1 px-3">{FOOTER_NAV.map(renderItem)}</nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand sidebar' : undefined}
        className={`mt-auto flex items-center h-11 mx-3 mb-4 rounded-xl text-sm text-black/50 hover:text-black hover:bg-black/[0.03] transition-colors duration-200 ${
          collapsed ? 'justify-center' : 'gap-3 px-3'
        }`}
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
