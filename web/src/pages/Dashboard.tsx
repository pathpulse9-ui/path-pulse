import { useEffect, useState } from 'react';
import type { HealthResponse, DistributionAccount } from '@pathpulse/contract';
import { api } from '../api/client';
import { Card, StatCard, Badge, Button } from '../ui/components';

const ROLE_LABEL: Record<string, string> = {
  partner_revenue: 'Partner Revenue',
  driver_pool: 'Driver Pool',
  treasury: 'Treasury',
};

function horizonAccountUrl(pk: string, network: string) {
  const net = network === 'testnet' ? 'testnet' : 'public';
  return `https://stellar.expert/explorer/${net}/account/${pk}`;
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [accounts, setAccounts] = useState<DistributionAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [h, a] = await Promise.all([api.health(), api.distributionAccounts()]);
      setHealth(h);
      setAccounts(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const provisioned = accounts.filter((a) => a.publicKey).length;

  return (
    <div>
      <h1 className="pp-page__title">Dashboard</h1>
      <p className="pp-page__sub">
        Phase 1 · Managed account infrastructure. Live from Backend Core at{' '}
        <code>{api.base}</code>.
      </p>

      {error && (
        <Card
          title={<span style={{ color: 'var(--danger)' }}>Backend Core unreachable</span>}
          actions={<Button variant="secondary" onClick={load}>Retry</Button>}
        >
          <p className="pp-muted">{error}</p>
          <p className="pp-muted">
            Start it with <code>npm run dev:backend</code> from the repo root.
          </p>
        </Card>
      )}

      {!error && (
        <>
          <div className="pp-grid" style={{ marginBottom: 'var(--sp-5)' }}>
            <StatCard
              label="Backend Core"
              value={loading ? '…' : health ? 'Online' : '—'}
              tone={health ? 'success' : undefined}
              hint={health ? `v${health.version}` : undefined}
            />
            <StatCard label="Network" value={loading ? '…' : health?.network ?? '—'} />
            <StatCard
              label="Distribution accounts"
              value={loading ? '…' : `${provisioned}/3`}
              tone={provisioned === 3 ? 'success' : 'warn'}
              hint="provisioned on testnet"
            />
          </div>

          <Card
            title="Distribution accounts"
            actions={<Button variant="secondary" onClick={load}>Refresh</Button>}
          >
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Account</th>
                  <th>Multisig</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.role}>
                    <td>{ROLE_LABEL[a.role] ?? a.role}</td>
                    <td className="mono">
                      {a.publicKey ? (
                        <a href={horizonAccountUrl(a.publicKey, a.network)} target="_blank" rel="noreferrer">
                          {a.publicKey.slice(0, 6)}…{a.publicKey.slice(-6)}
                        </a>
                      ) : (
                        <span className="pp-muted">not provisioned</span>
                      )}
                    </td>
                    <td>
                      {a.role === 'treasury' ? (
                        <Badge tone={a.multisig ? 'success' : 'warn'}>
                          {a.multisig ? 'active' : 'human gate'}
                        </Badge>
                      ) : (
                        <span className="pp-muted">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && accounts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="pp-muted">No accounts returned.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
