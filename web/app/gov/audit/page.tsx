'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DistributionAccount, LedgerEntry, LedgerPage, TreasuryConfig } from '@pathpulse/contract';
import { listDistributionAccounts, getTreasuryConfig, getLedger } from '../../lib/api';
import { explorerTx } from '../../lib/network';

const ROLE_LABEL: Record<string, string> = {
  partner_revenue: 'Authorities (50%)',
  driver_pool: 'Driver pool (30%)',
  treasury: 'Treasury (20%)',
  settlement_source: 'Settlement source',
  routing_source: 'Routing source',
};

const LINK_LABEL: Record<NonNullable<LedgerEntry['link']>, string> = {
  settlement: 'split',
  deposit: 'deposit',
  conversion: 'conversion',
};

export default function GovAuditPage() {
  const [accounts, setAccounts] = useState<DistributionAccount[]>([]);
  const [treasury, setTreasury] = useState<TreasuryConfig | null>(null);
  const [account, setAccount] = useState('');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [indexer, setIndexer] = useState<LedgerPage['indexer']>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listDistributionAccounts(), getTreasuryConfig()])
      .then(([a, t]) => {
        setAccounts(a);
        setTreasury(t);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const load = useCallback(async (from: string | null, filter: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await getLedger({ account: filter || undefined, cursor: from ?? undefined, limit: 50 });
      setEntries((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setIndexer(page.indexer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(null, account);
  }, [account, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-2 text-sm text-black/60">
          Every payment into or out of the protocol accounts, indexed from Horizon and linked to the settlement batch
          it belongs to.
        </p>
        {indexer && (
          <p className="mt-1 text-xs text-black/40">
            Indexer last ran {indexer.at.slice(0, 19).replace('T', ' ')} UTC
            {indexer.error ? ` — error: ${indexer.error}` : ''}
          </p>
        )}
      </div>

      {error && <div className="rounded-3xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {treasury && (
        <section className="rounded-3xl bg-white p-6">
          <div className="text-sm font-semibold">Treasury multisig</div>
          <div className="mt-1 text-xs text-black/50">
            Master weight 0 disables direct signing — {treasury.thresholds.high} of{' '}
            {treasury.signers.filter((s) => s.weight > 0).length} required.
          </div>
          <ul className="mt-5 divide-y divide-black/5">
            {treasury.signers.map((s) => (
              <li key={s.publicKey} className="flex items-center gap-3 py-2">
                <span className="font-mono text-xs text-black/70">{s.publicKey}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    s.weight === 0 ? 'bg-red-100 text-red-700' : 'bg-[#03C394]/25 text-[#032018]'
                  }`}
                >
                  weight {s.weight}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-3xl bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-black/5 p-6">
          <div className="text-sm font-semibold">Ledger</div>
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="ml-auto rounded-full border border-black/15 bg-white px-4 py-2 text-xs"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.publicKey} value={a.publicKey}>
                {ROLE_LABEL[a.role] ?? a.role}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/[.03] text-left text-[11px] uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Account</th>
                <th className="px-5 py-3">Direction</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3">Counterparty</th>
                <th className="px-5 py-3">Transaction</th>
                <th className="px-5 py-3">Batch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {entries.map((e) => (
                <tr key={`${e.id}-${e.account}`}>
                  <td className="px-5 py-3 text-xs text-black/50">{e.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td className="px-5 py-3 text-xs">{ROLE_LABEL[e.role] ?? e.role}</td>
                  <td className="px-5 py-3 text-xs">{e.direction === 'in' ? 'In' : 'Out'}</td>
                  <td className="px-5 py-3 text-right font-medium">
                    {e.amount} {e.assetCode}
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-black/60">
                    {short(e.direction === 'in' ? e.from : e.to)}
                  </td>
                  <td className="px-5 py-3">
                    <a
                      href={explorerTx(e.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-blue-700 hover:underline"
                    >
                      {e.txHash.slice(0, 8)}…
                    </a>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {e.settlementBatchId ? (
                      <Link href={`/gov/settlements/${e.settlementBatchId}`} className="text-blue-700 hover:underline">
                        {e.link ? LINK_LABEL[e.link] : 'batch'}
                      </Link>
                    ) : (
                      <span className="text-black/40">unlinked</span>
                    )}
                  </td>
                </tr>
              ))}
              {!entries.length && !loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-black/40">
                    No indexed payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <div className="border-t border-black/5 p-4 text-center">
            <button
              onClick={() => void load(cursor, account)}
              disabled={loading}
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium text-black hover:bg-black/5 disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function short(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}
