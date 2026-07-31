import { useEffect, useState, useCallback } from 'react';
import type { SettlementBatch } from '@pathpulse/contract';
import { api } from '../api/client';
import { Card, Button, Badge, StatCard, EmptyState } from '../ui/components';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;

export function Settlement() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [selected, setSelected] = useState<SettlementBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listSettlementBatches(50);
      setBatches(page.items);
      setSelected((cur) => cur ?? page.items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reviewer demo: onboard 3 sample drivers (tiers 1/2/3), then run a 100 XLM batch.
  async function runSample() {
    setRunning(true);
    setError(null);
    try {
      const tiers = [1, 2, 3] as const;
      const drivers = [];
      for (let i = 0; i < tiers.length; i++) {
        const r = await api.onboard(`sample-driver-${i + 1}`);
        drivers.push({ userId: r.userId, address: r.wallet.address, tier: tiers[i] });
      }
      const batch = await api.createSettlementBatch({ grossAmount: '100', drivers });
      setSelected(batch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample settlement failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <h1 className="pp-page__title">
        Settlement Explorer <Badge tone="brand">Testnet</Badge>
      </h1>
      <p className="pp-page__sub">
        PAT-13 · D6 — deterministic 50 / 30 / 20 revenue split with SCOUT reputation multipliers.
        Drill down: Source → Split → Driver.
      </p>

      <Card
        title="Settlement batches"
        actions={
          <>
            <Button variant="secondary" disabled={loading} onClick={load}>Refresh</Button>
            <Button disabled={running} onClick={runSample}>
              {running ? 'Running…' : 'Run sample settlement (100 XLM)'}
            </Button>
          </>
        }
      >
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {!error && batches.length === 0 && !loading && (
          <EmptyState title="No settlement batches yet">
            Run a sample settlement to execute a 50/30/20 split on testnet.
          </EmptyState>
        )}
        {batches.length > 0 && (
          <table className="pp-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Created</th>
                <th>Gross</th>
                <th>Drivers</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setSelected(b)}
                  style={{ cursor: 'pointer', background: selected?.id === b.id ? 'var(--brand-fade)' : undefined }}
                >
                  <td className="mono">{b.id.replace('stl_', '').slice(0, 14)}…</td>
                  <td className="pp-muted">{new Date(b.createdAt).toLocaleTimeString()}</td>
                  <td>{b.grossAmount} XLM</td>
                  <td>{b.driverPayouts.length}</td>
                  <td className="mono">
                    <a href={explorerTx(b.txHash)} target="_blank" rel="noreferrer">{short(b.txHash)}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <h2 style={{ marginBottom: 'var(--sp-3)' }}>
            Drill-down · <span className="mono pp-muted">{selected.id}</span>
          </h2>

          <div className="pp-grid" style={{ marginBottom: 'var(--sp-4)' }}>
            <StatCard label="Authorities · 50%" value={`${selected.split.authorities} XLM`} hint={short(selected.authoritiesAddress)} />
            <StatCard label="Driver Rewards · 30%" value={`${selected.split.driverRewards} XLM`} tone="success" hint={`${selected.driverPayouts.length} drivers`} />
            <StatCard label="Treasury · 20%" value={`${selected.split.treasury} XLM`} hint={short(selected.treasuryAddress)} />
          </div>

          <Card title="Source → Split → Driver">
            <p className="pp-muted" style={{ marginTop: 0 }}>
              Funded from <span className="mono">{short(selected.sourceAddress)}</span> · settled on-chain in one multi-op transaction ·{' '}
              <a href={explorerTx(selected.txHash)} target="_blank" rel="noreferrer">view on stellar.expert</a>
            </p>
            <table className="pp-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>SCOUT tier</th>
                  <th>Multiplier</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {selected.driverPayouts.map((d) => (
                  <tr key={d.address}>
                    <td className="mono">{short(d.address)}</td>
                    <td><Badge tone={d.tier === 3 ? 'success' : d.tier === 2 ? 'brand' : 'neutral'}>SCOUT{d.tier}</Badge></td>
                    <td>{d.multiplier.toFixed(1)}×</td>
                    <td>{d.amount} XLM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
