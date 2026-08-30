'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayoutBatch, PayoutReceiptStatus, SettlementBatch } from '@pathpulse/contract';
import {
  listPayoutBatches,
  createPayoutBatch,
  listSettlementBatches,
  listPayoutAttempts,
  type PayoutAttempt,
} from '../../lib/api';
import { usePageActions } from '../../components/dashboard/PageActions';
import { T } from '../../components/dashboard/typography';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;

function attemptClasses(outcome: string) {
  return outcome === 'success'
    ? 'bg-green-100 text-green-700 border-green-300'
    : 'bg-red-100 text-red-700 border-red-300';
}

function receiptClasses(s: PayoutReceiptStatus) {
  if (s === 'success') return 'bg-green-100 text-green-700 border-green-300';
  if (s === 'failed') return 'bg-red-100 text-red-700 border-red-300';
  if (s === 'pending') return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-black/5 text-black/60 border-black/10';
}

export default function PayoutsPage() {
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [settlements, setSettlements] = useState<SettlementBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, PayoutAttempt[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([listPayoutBatches(50), listSettlementBatches(20)]);
      setBatches(p.items);
      setSettlements(s.items);
      const rows = await Promise.all(
        p.items.map(async (b) => {
          try {
            return [b.id, (await listPayoutAttempts(b.id)).attempts] as const;
          } catch {
            return [b.id, [] as PayoutAttempt[]] as const;
          }
        }),
      );
      setAttempts(Object.fromEntries(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach Backend Core');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  usePageActions(
    () => (
      <button onClick={load} disabled={loading} className={T.buttonSecondary}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    ),
    [load, loading],
  );

  const disburse = useCallback(
    async (settlementBatchId: string) => {
      setCreating(true);
      setError(null);
      try {
        await createPayoutBatch(settlementBatchId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Disbursement failed');
      } finally {
        setCreating(false);
      }
    },
    [load],
  );

  const undisbursed = settlements.filter(
    (s) => !batches.some((b) => b.settlementBatchId === s.id),
  );

  return (
    <div className={T.sectionStack}>
      {error && (
        <div className={T.card}>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className={`${T.card} space-y-4`}>
        <div>
          <h2 className={T.cardTitle}>Disburse a settlement</h2>
          <p className={`${T.cardDescription} mt-1`}>
            Hand a settled batch to the Stellar Disbursement Platform. SDP creates the
            disbursement, uploads instructions and pays each driver, reporting per-recipient
            status back here.
          </p>
        </div>

        {undisbursed.length === 0 ? (
          <p className={T.bodyMuted}>
            {settlements.length === 0
              ? 'No settlement batches yet — run one from the Settlement tab first.'
              : 'Every settlement batch has already been disbursed.'}
          </p>
        ) : (
          <div className="space-y-2">
            {undisbursed.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-black/10 p-4 flex items-center gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-black/60 truncate">{s.id}</div>
                  <div className={`${T.bodyMuted} mt-1`}>
                    {s.split.driverRewards} XLM to {s.driverPayouts.length} driver
                    {s.driverPayouts.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  onClick={() => disburse(s.id)}
                  disabled={creating}
                  className={T.buttonPrimary}
                >
                  {creating ? 'Disbursing…' : 'Disburse via SDP'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {batches.length === 0 && !loading && (
        <div className={T.card}>
          <div className="rounded-xl border border-dashed border-black/15 p-8 text-center">
            <p className="font-medium text-black">No disbursements yet</p>
            <p className={`${T.bodyMuted} mt-1`}>
              Disburse a settlement batch above to see SDP orchestration here.
            </p>
          </div>
        </div>
      )}

      {batches.map((b) => (
        <div key={b.id} className={`${T.card} space-y-4`}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className={T.cardTitle}>
                {b.provider.toUpperCase()} disbursement{' '}
                <span
                  className={`align-middle text-xs font-medium rounded-full border px-2 py-0.5 ${
                    b.sandbox
                      ? 'bg-amber-100 text-amber-700 border-amber-300'
                      : 'bg-green-100 text-green-700 border-green-300'
                  }`}
                >
                  {b.sandbox ? 'SANDBOX' : 'LIVE'}
                </span>
              </h2>
              <p className={`${T.cardDescription} mt-1 font-mono text-xs`}>{b.id}</p>
            </div>
            <div className="text-right">
              <div className={T.metric}>
                {b.totalAmount} <span className="text-black/40 text-base">{b.asset.code}</span>
              </div>
              <div className={T.metricLabel}>{b.status}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={T.cardInner}>
              <div className={T.metricLabel}>Settlement batch</div>
              <div className="font-mono text-xs text-black/70 mt-1 truncate">
                {b.settlementBatchId ?? '—'}
              </div>
            </div>
            <div className={T.cardInner}>
              <div className={T.metricLabel}>SDP disbursement</div>
              <div className="font-mono text-xs text-black/70 mt-1 truncate">
                {b.disbursementId ?? '—'}
              </div>
            </div>
          </div>

          {(attempts[b.id]?.length ?? 0) > 0 && (
            <div className={T.cardInner}>
              <div className={T.metricLabel}>SDP call attempts (reconciliation)</div>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className={T.tableHeadRow}>
                    <th className={T.tableHeadCell}>#</th>
                    <th className={T.tableHeadCell}>Step</th>
                    <th className={T.tableHeadCell}>Outcome</th>
                    <th className={T.tableHeadCell}>Duration</th>
                    <th className={T.tableHeadCell}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts[b.id].map((a) => (
                    <tr key={a.id} className={T.tableRow}>
                      <td className={T.tableCell}>{a.attempt}</td>
                      <td className={`${T.tableCell} font-mono text-xs`}>{a.step}</td>
                      <td className={T.tableCell}>
                        <span
                          className={`text-xs rounded-full border px-2 py-0.5 ${attemptClasses(a.outcome)}`}
                        >
                          {a.outcome}
                        </span>
                      </td>
                      <td className={T.tableCell}>{a.duration_ms}ms</td>
                      <td className={`${T.tableCell} text-xs text-red-700`}>{a.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className={T.tableHeadRow}>
                <th className={T.tableHeadCell}>Driver</th>
                <th className={T.tableHeadCell}>Tier</th>
                <th className={T.tableHeadCell}>Amount</th>
                <th className={T.tableHeadCell}>Status</th>
                <th className={T.tableHeadCell}>Stellar tx</th>
              </tr>
            </thead>
            <tbody>
              {b.receipts.map((r) => (
                <tr key={r.address} className={T.tableRow}>
                  <td className={`${T.tableCell} font-mono text-xs`}>{short(r.address)}</td>
                  <td className={T.tableCell}>SCOUT{r.tier}</td>
                  <td className={T.tableCell}>{r.amount}</td>
                  <td className={T.tableCell}>
                    <span
                      className={`text-xs rounded-full border px-2 py-0.5 ${receiptClasses(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className={`${T.tableCell} font-mono text-xs`}>
                    {r.stellarTxHash ? (
                      <a
                        href={explorerTx(r.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-black transition-colors duration-200"
                      >
                        {short(r.stellarTxHash)}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
