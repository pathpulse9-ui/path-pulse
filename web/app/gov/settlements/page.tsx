'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SettlementBatch } from '@pathpulse/contract';
import { listSettlementBatches, settlementCsvUrl, type BatchListParams } from '../../lib/api';

/**
 * Filterable settlement list. Filters are sent to /v1/settlement/batches so
 * Postgres does the filtering; the CSV export button hands the same params
 * to /v1/settlement/batches/export.csv for a matching download.
 */
export default function GovSettlementsPage() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter inputs (bound to form; committed to `params` on submit).
  const [assetCode, setAssetCode] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [params, setParams] = useState<BatchListParams>({ limit: 200 });

  const csvHref = useMemo(() => settlementCsvUrl(params), [params]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await listSettlementBatches(params);
        if (!cancelled) setBatches(page.items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({
      limit: 200,
      assetCode: assetCode || undefined,
      since:     since || undefined,
      until:     until || undefined,
      minAmount: minAmount || undefined,
      maxAmount: maxAmount || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Settlements</h1>
        <span className="text-sm text-black/50">{batches.length} shown</span>
        <a
          href={csvHref}
          className="ml-auto rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium text-black hover:bg-black/5"
          download
        >
          Export CSV
        </a>
      </div>

      <form onSubmit={apply} className="rounded-3xl bg-white p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <FilterField label="Asset code" value={assetCode} onChange={setAssetCode} placeholder="XLM / USDC" />
          <FilterField label="Since (ISO)" value={since} onChange={setSince} placeholder="2026-01-01" />
          <FilterField label="Until (ISO)" value={until} onChange={setUntil} placeholder="2026-12-31" />
          <FilterField label="Min amount"  value={minAmount} onChange={setMinAmount} placeholder="0" />
          <FilterField label="Max amount"  value={maxAmount} onChange={setMaxAmount} placeholder="10000" />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            className="rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/85"
          >
            {loading ? 'Filtering…' : 'Apply filters'}
          </button>
          <button
            type="button"
            className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium text-black hover:bg-black/5"
            onClick={() => {
              setAssetCode(''); setSince(''); setUntil(''); setMinAmount(''); setMaxAmount('');
              setParams({ limit: 200 });
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-3xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-3xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-black/[.03] text-left text-[11px] uppercase tracking-wide text-black/50">
            <tr>
              <th className="px-5 py-3">Batch</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3">Asset</th>
              <th className="px-5 py-3 text-right">Gross</th>
              <th className="px-5 py-3 text-right">Authorities</th>
              <th className="px-5 py-3 text-right">Driver rewards</th>
              <th className="px-5 py-3 text-right">Treasury</th>
              <th className="px-5 py-3">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {batches.map((b) => (
              <tr key={b.id} className="hover:bg-black/[.02]">
                <td className="px-5 py-3">
                  <Link href={`/gov/settlements/${b.id}`} className="font-mono text-xs hover:underline">
                    {b.id.slice(0, 22)}…
                  </Link>
                </td>
                <td className="px-5 py-3 text-xs text-black/60">{b.createdAt.replace('T', ' ').slice(0, 19)}</td>
                <td className="px-5 py-3 text-xs">{b.asset.code}</td>
                <td className="px-5 py-3 text-right">{b.grossAmount}</td>
                <td className="px-5 py-3 text-right text-black/70">{b.split.authorities}</td>
                <td className="px-5 py-3 text-right text-black/70">{b.split.driverRewards}</td>
                <td className="px-5 py-3 text-right text-black/70">{b.split.treasury}</td>
                <td className="px-5 py-3">
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${b.txHash}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[11px] text-blue-700 hover:underline"
                  >
                    {b.txHash.slice(0, 8)}…{b.txHash.slice(-4)}
                  </a>
                </td>
              </tr>
            ))}
            {batches.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-sm text-black/40">
                  No batches match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-black/50">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-black/40 focus:outline-none"
      />
    </label>
  );
}
