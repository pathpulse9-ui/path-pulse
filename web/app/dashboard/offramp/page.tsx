'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OffRampSession, OffRampStatus, OffRampQuote } from '@pathpulse/contract';
import {
  listOffRampSessions,
  getOffRampSession,
  createOffRampWithdrawal,
  getOffRampQuote,
} from '../../lib/api';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const STATUS_LABEL: Record<OffRampStatus, string> = {
  pending_user_transfer_start: 'Awaiting your crypto transfer',
  pending_anchor: 'Carret converting → INR',
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
  const [amount, setAmount] = useState('10');
  const [batchId, setBatchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<OffRampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

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

  useEffect(() => {
    const valid = /^\d+(\.\d{1,7})?$/.test(amount.trim()) && Number(amount) > 0;
    if (!valid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await getOffRampQuote(amount.trim());
        if (!cancelled) {
          setQuote(q);
          setQuoteError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(e instanceof Error ? e.message : 'Quote failed');
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amount]);

  async function startWithdrawal() {
    setBusy(true);
    setError(null);
    try {
      const session = await createOffRampWithdrawal({
        amount,
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
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 space-y-4">
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
          Start a withdrawal
        </h2>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-sm">
            <span className="block text-black/50 mb-1">Amount (USDC)</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 py-2 text-sm w-32 focus:outline-none focus:border-black/30"
            />
          </label>
          <label className="text-sm flex-1 min-w-48">
            <span className="block text-black/50 mb-1">Settlement batch ID (optional)</span>
            <input
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              placeholder="stl_… (links the off-ramp to a settlement)"
              className="rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 py-2 text-sm w-full font-mono focus:outline-none focus:border-black/30"
            />
          </label>
          <button
            onClick={startWithdrawal}
            disabled={busy}
            className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Sell to fiat'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {quoteError && <p className="text-sm text-red-600">{quoteError}</p>}

        {quote && (
          <div className="rounded-xl bg-black/[0.03] p-4 space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="text-black">
                <span className="text-xl font-medium">{quote.amount}</span>{' '}
                <span className="text-sm text-black/50">{quote.asset}</span>
                <span className="text-black/30 mx-2">→</span>
                <span className="text-xl font-medium">{quote.fiatAmount}</span>{' '}
                <span className="text-sm text-black/50">{quote.fiatCurrency}</span>
              </div>
              <span className="text-xs text-black/50">
                {quoting
                  ? 'refreshing…'
                  : quote.live
                    ? `live · ${quote.provider}${quote.quoteId ? ` · #${quote.quoteId}` : ''}`
                    : 'indicative estimate'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-black/50">Rate</div>
                <div className="text-black mt-1">
                  1 {quote.asset} = {quote.rate} {quote.fiatCurrency}
                </div>
              </div>
              <div>
                <div className="text-xs text-black/50">Gross</div>
                <div className="text-black mt-1">
                  {quote.grossFiatAmount} {quote.fiatCurrency}
                </div>
              </div>
            </div>

            {quote.fees.length > 0 && (
              <div>
                <div className="text-xs text-black/50 mb-1">Deductions</div>
                <div className="space-y-1">
                  {quote.fees.map((f: OffRampQuote['fees'][number]) => (
                    <div key={f.label} className="flex justify-between text-sm">
                      <span className="text-black/60">{f.label}</span>
                      <span className="text-black">
                        −{f.amount} {quote.fiatCurrency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-2xl bg-white p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-mono text-sm text-black">{selected.id}</h2>
            <span className={`text-xs rounded-full border px-2 py-0.5 ${statusClasses(selected.status)}`}>
              {STATUS_LABEL[selected.status]}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-black/50 text-xs">Amount</div>
              <div className="font-medium text-black">{selected.amount} {selected.asset.code}</div>
            </div>
            <div>
              <div className="text-black/50 text-xs">You receive (est.)</div>
              <div className="font-medium text-black">≈ {selected.fiatAmountEstimate} {selected.fiatCurrency}</div>
            </div>
            <div>
              <div className="text-black/50 text-xs">Anchor</div>
              <div className="font-mono text-xs">{selected.anchorAccount ? short(selected.anchorAccount) : '—'}</div>
            </div>
            <div>
              <div className="text-black/50 text-xs">Settlement</div>
              <div className="font-mono text-xs">{selected.settlementBatchId ? short(selected.settlementBatchId) : '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            <a
              href={selected.interactiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 transition-colors duration-200"
            >
              Open anchor webview (KYC + conversion)
            </a>
            {selected.sandbox && (
              <span className="text-xs text-black/40">
                sandbox: status auto-advances (transfer → anchor → completed)
              </span>
            )}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="rounded-2xl bg-white p-6">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em] mb-3">
            Recent withdrawals
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
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
                  className={`border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors duration-200 ${
                    selected?.id === s.id ? 'bg-black/5' : ''
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
  );
}
