'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OffRampSession, OffRampStatus } from '@pathpulse/contract';
import { listOffRampSessions, getOffRampSession, createOffRampWithdrawal } from '../lib/api';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const STATUS_LABEL: Record<OffRampStatus, string> = {
  pending_user_transfer_start: 'Awaiting your stablecoin transfer',
  pending_anchor: 'Anchor converting → fiat',
  completed: 'Completed',
  error: 'Error',
};

function statusClasses(s: OffRampStatus) {
  if (s === 'completed') return 'bg-green-100 text-green-700 border-green-300';
  if (s === 'error') return 'bg-red-100 text-red-700 border-red-300';
  if (s === 'pending_anchor') return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-amber-100 text-amber-700 border-amber-300';
}

export default function OffRampPage() {
  const [sessions, setSessions] = useState<OffRampSession[]>([]);
  const [selected, setSelected] = useState<OffRampSession | null>(null);
  const [amount, setAmount] = useState('30');
  const [batchId, setBatchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await listOffRampSessions(50);
      setSessions(page.items);
      setSelected((cur) => (cur ? page.items.find((s) => s.id === cur.id) ?? cur : page.items[0] ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Poll the selected session while it's in flight (status advances anchor-side).
  useEffect(() => {
    if (!selected || selected.status === 'completed' || selected.status === 'error') return;
    const t = setInterval(async () => {
      try {
        const s = await getOffRampSession(selected.id);
        setSelected(s);
        setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x)));
      } catch {
        /* ignore transient */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [selected]);

  async function startWithdrawal() {
    setBusy(true);
    setError(null);
    try {
      const session = await createOffRampWithdrawal({
        amount,
        fiatCurrency: 'INR',
        settlementBatchId: batchId.trim() || undefined,
      });
      setSelected(session);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start withdrawal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            Off-ramp Reconciliation{' '}
            <span className="align-middle text-xs font-medium rounded-full border border-blue-300 bg-blue-100 text-blue-700 px-2 py-0.5">
              TESTNET
            </span>
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            PAT-11 · D4 — Mercuryo SEP-24 interactive withdrawal (stablecoin → fiat). Mercuryo owns
            KYC / conversion / custody. Running against the <strong>sandbox stub</strong> until live
            credentials land.
          </p>
        </div>

        <div className="rounded border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold">Start a withdrawal</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-sm">
              <span className="block text-gray-500 mb-1">Amount (USDC)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm w-32"
              />
            </label>
            <label className="text-sm flex-1 min-w-48">
              <span className="block text-gray-500 mb-1">Settlement batch ID (optional)</span>
              <input
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="stl_… (links the off-ramp to a settlement)"
                className="rounded border border-gray-300 px-3 py-1.5 text-sm w-full font-mono"
              />
            </label>
            <button
              onClick={startWithdrawal}
              disabled={busy}
              className="rounded bg-black px-4 py-1.5 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Withdraw to INR'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {selected && (
          <div className="rounded border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold font-mono text-sm">{selected.id}</h2>
              <span className={`text-xs rounded-full border px-2 py-0.5 ${statusClasses(selected.status)}`}>
                {STATUS_LABEL[selected.status]}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-gray-500 text-xs">Amount</div>
                <div className="font-medium">{selected.amount} {selected.asset.code}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">You receive (est.)</div>
                <div className="font-medium">≈ {selected.fiatAmountEstimate} {selected.fiatCurrency}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">Anchor</div>
                <div className="font-mono text-xs">{selected.anchorAccount ? short(selected.anchorAccount) : '—'}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">Settlement</div>
                <div className="font-mono text-xs">{selected.settlementBatchId ? short(selected.settlementBatchId) : '—'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <a
                href={selected.interactiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-300 px-3 py-1.5 text-sm"
              >
                Open anchor webview (KYC + conversion)
              </a>
              {selected.sandbox && (
                <span className="text-xs text-gray-400">
                  sandbox: status auto-advances (transfer → anchor → completed)
                </span>
              )}
            </div>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="rounded border border-gray-200 p-4">
            <h2 className="font-semibold mb-2">Recent withdrawals</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 font-medium">Session</th>
                  <th className="py-2 font-medium">Amount</th>
                  <th className="py-2 font-medium">Fiat est.</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                      selected?.id === s.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="py-2 font-mono text-xs">{s.id.replace('ofr_', '').slice(0, 14)}…</td>
                    <td className="py-2">{s.amount} {s.asset.code}</td>
                    <td className="py-2">≈ {s.fiatAmountEstimate} {s.fiatCurrency}</td>
                    <td className="py-2">
                      <span className={`text-xs rounded-full border px-2 py-0.5 ${statusClasses(s.status)}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
