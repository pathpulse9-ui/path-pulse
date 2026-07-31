import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button } from './components';

interface NavItem {
  to: string;
  label: string;
  phase: string;
  ready?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', phase: 'P1', ready: true },
  { to: '/wallets', label: 'Wallet Interop', phase: 'P2', ready: true },
  { to: '/payouts', label: 'Payouts (SDP)', phase: 'P2' },
  { to: '/offramp', label: 'Off-ramp Recon', phase: 'P3' },
  { to: '/settlement', label: 'Settlement Explorer', phase: 'P4' },
  { to: '/gov', label: 'Gov Gateway', phase: 'P6' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  return (
    <div className="pp-shell">
      <aside className="pp-sidebar">
        <div className="pp-sidebar__brand">
          PathPulse <Badge tone="brand">Ops</Badge>
        </div>
        <nav className="pp-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => 'pp-nav__item' + (isActive ? ' is-active' : '')}
            >
              <span>{item.label}</span>
              {!item.ready && <span className="pp-nav__phase">{item.phase}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="pp-sidebar__foot pp-muted">Stellar testnet</div>
      </aside>
      <div className="pp-main">
        <header className="pp-topbar">
          <div className="pp-muted">Internal operations console</div>
          <div className="pp-topbar__right">
            {session && <span className="pp-muted">{session.operator}</span>}
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="pp-content">{children}</main>
      </div>
    </div>
  );
}
