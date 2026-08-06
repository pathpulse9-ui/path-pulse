'use client';

import { useCallback, useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import type { SettlementBatch } from '@pathpulse/contract';
import { FRIENDBOT_URL } from '../../lib/stellar';
import { listSettlementBatches, createSettlementBatch } from '../../lib/api';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

async function makeFundedDriver(): Promise<string> {
  const kp = Keypair.random();
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`);
  if (!res.ok) throw new Error(`Friendbot HTTP ${res.status}`);
  return kp.publicKey();
}

function tierClasses(tier: number) {
  if (tier === 3) return 'bg-green-100 text-green-700 border-green-300';
  if (tier === 2) return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-black/5 text-black/60 border-black/10';
}

export default function SettlementPage() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [selected, setSelected] = useState<SettlementBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSettlementBatches(50);
      setBatches(page.items);
      setSelected((cur) => cur ?? page.items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Reviewer demo: generate + Friendbot-fund 3 driver accounts (tiers 1/2/3),
  // then run a 100 XLM settlement through the backend engine.
  const runSample = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      setStatus('Funding 3 sample driver accounts on testnet…');
      const tiers = [1, 2, 3] as const;
      const drivers = [];
      for (let i = 0; i < tiers.length; i++) {
        const address = await makeFundedDriver();
        drivers.push({ userId: `sample-driver-${i + 1}`, address, tier: tiers[i] });
      }
      setStatus('Executing 50/30/20 settlement…');
      const batch = await createSettlementBatch({ grossAmount: '100', drivers });
      setSelected(batch);
      await load();
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample settlement failed');
      setStatus(null);
    } finally {
      setRunning(false);
    }
  }, [load]);

  return (
    <div>
      <div>
        <div className="space-y-6">
          <div>
            <h1
              className="text-black text-3xl md:text-4xl font-medium leading-tight"
              style={{ letterSpacing: '-0.03em' }}
            >
              Settlement Explorer{' '}
              <span className="align-middle text-xs font-medium rounded-full border border-blue-300 bg-blue-100 text-blue-700 px-2 py-0.5">
                TESTNET
              </span>
            </h1>
            <p className="text-sm text-black/60 mt-2">
              Deterministic 50 / 30 / 20 revenue split with SCOUT reputation multipliers.
              Drill down: Source → Split → Driver.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
                Settlement batches
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={load}
                  disabled={loading}
                  className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200 disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  onClick={runSample}
                  disabled={running}
                  className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
                >
                  {running ? 'Running…' : 'Run sample settlement (100 XLM)'}
                </button>
              </div>
            </div>

            {status && <p className="text-sm text-black/50">{status}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {!error && batches.length === 0 && !loading && !running && (
              <div className="rounded-xl border border-dashed border-black/15 p-8 text-center">
                <p className="font-medium text-black">No settlement batches yet</p>
                <p className="text-sm text-black/50 mt-1">
                  Run a sample settlement to execute a 50/30/20 split on testnet.
                </p>
              </div>
            )}

            {batches.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-black/50 border-b border-black/10">
                    <th className="py-2 font-medium">Batch</th>
                    <th className="py-2 font-medium">Created</th>
                    <th className="py-2 font-medium">Gross</th>
                    <th className="py-2 font-medium">Drivers</th>
                    <th className="py-2 font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => setSelected(b)}
                      className={`border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors duration-200 ${
                        selected?.id === b.id ? 'bg-black/5' : ''
                      }`}
                    >
                      <td className="py-2 font-mono text-xs">{b.id.replace('stl_', '').slice(0, 14)}…</td>
                      <td className="py-2 text-black/50">{new Date(b.createdAt).toLocaleTimeString()}</td>
                      <td className="py-2">{b.grossAmount} XLM</td>
                      <td className="py-2">{b.driverPayouts.length}</td>
                      <td className="py-2 font-mono text-xs">
                        <a
                          href={explorerTx(b.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-black transition-colors duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {short(b.txHash)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selected && (
            <div className="space-y-4">
              <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
                Drill-down · <span className="font-mono text-sm text-black/50">{selected.id}</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-white p-6">
                  <div className="text-xs text-black/50">Authorities · 50%</div>
                  <div className="text-xl font-medium mt-1 text-black">{selected.split.authorities} XLM</div>
                  <div className="text-xs text-black/40 mt-1 font-mono">{short(selected.authoritiesAddress)}</div>
                </div>
                <div className="rounded-2xl bg-white p-6">
                  <div className="text-xs text-black/50">Driver Rewards · 30%</div>
                  <div className="text-xl font-medium mt-1 text-green-600">{selected.split.driverRewards} XLM</div>
                  <div className="text-xs text-black/40 mt-1">{selected.driverPayouts.length} drivers</div>
                </div>
                <div className="rounded-2xl bg-white p-6">
                  <div className="text-xs text-black/50">Treasury · 20%</div>
                  <div className="text-xl font-medium mt-1 text-black">{selected.split.treasury} XLM</div>
                  <div className="text-xs text-black/40 mt-1 font-mono">{short(selected.treasuryAddress)}</div>
                </div>
              </div>

              <div className="rounded-2xl bg-white p-6">
                <h3 className="text-black font-medium mb-1" style={{ letterSpacing: '-0.02em' }}>
                  Source → Split → Driver
                </h3>
                <p className="text-sm text-black/50 mb-4">
                  Funded from <span className="font-mono">{short(selected.sourceAddress)}</span> · settled
                  on-chain in one multi-op transaction ·{' '}
                  <a
                    href={explorerTx(selected.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-black transition-colors duration-200"
                  >
                    view on stellar.expert
                  </a>
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-black/50 border-b border-black/10">
                      <th className="py-2 font-medium">Driver</th>
                      <th className="py-2 font-medium">SCOUT tier</th>
                      <th className="py-2 font-medium">Multiplier</th>
                      <th className="py-2 font-medium">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.driverPayouts.map((d) => (
                      <tr key={d.address} className="border-b border-black/5">
                        <td className="py-2 font-mono text-xs">
                          <a
                            href={explorerAcct(d.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-black transition-colors duration-200"
                          >
                            {short(d.address)}
                          </a>
                        </td>
                        <td className="py-2">
                          <span className={`text-xs rounded-full border px-2 py-0.5 ${tierClasses(d.tier)}`}>
                            SCOUT{d.tier}
                          </span>
                        </td>
                        <td className="py-2">{d.multiplier.toFixed(1)}×</td>
                        <td className="py-2">{d.amount} XLM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
