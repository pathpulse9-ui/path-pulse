'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SettlementBatch } from '@pathpulse/contract';
import { getSettlementBatch, settlementReceiptPdfUrl } from '../../../lib/api';

/**
 * Full traceability for one settlement batch:
 *   Treasury source → Split → SDP payout batch → per-driver receipts.
 * Everything with a hash links to stellar.expert; PDF receipt is a
 * one-click download from the compliance export endpoint.
 */
export default function GovSettlementDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = use(params);
  const [batch, setBatch] = useState<SettlementBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setBatch(await getSettlementBatch(id));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error) {
    return <div className="rounded-3xl bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!batch) {
    return <div className="text-sm text-black/40">Loading…</div>;
  }

  const gross = Number(batch.grossAmount);
  const asset = batch.asset.code;
  const legs = [
    { pct: '50%', label: 'Authorities',    color: '#03C394',            amount: batch.split.authorities,    addr: batch.authoritiesAddress },
    { pct: '30%', label: 'Driver rewards', color: 'rgba(3,195,148,.60)', amount: batch.split.driverRewards, addr: batch.driverPoolAddress },
    { pct: '20%', label: 'Treasury',       color: 'rgba(3,195,148,.25)', amount: batch.split.treasury,       addr: batch.treasuryAddress },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/gov/settlements" className="text-xs text-black/50 hover:text-black">
          ← All settlements
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{batch.grossAmount} {asset}</h1>
          <span className="text-sm text-black/50">gross settled</span>
          <a
            href={settlementReceiptPdfUrl(batch.id)}
            className="ml-auto rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-medium text-black hover:bg-black/5"
          >
            Download PDF receipt
          </a>
        </div>
        <div className="mt-2 font-mono text-xs text-black/50">{batch.id}</div>
      </div>

      <section className="rounded-3xl bg-white p-6">
        <div className="text-sm font-semibold">On-chain proof</div>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Kv label="Network" value={batch.network} />
          <Kv label="Created" value={batch.createdAt} />
          <Kv label="Source"       value={batch.sourceAddress} mono />
          <Kv label="Tx hash"      value={batch.txHash} mono link={
            `https://stellar.expert/explorer/${batch.network === 'mainnet' ? 'public' : 'testnet'}/tx/${batch.txHash}`
          } />
          {batch.payoutBatchId && <Kv label="SDP payout" value={batch.payoutBatchId} mono />}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6">
        <div className="text-sm font-semibold">Deterministic split</div>
        <div className="mt-1 text-xs text-black/50">Enforced atomically in one Stellar transaction.</div>
        <div className="mt-6 flex h-3 gap-[2px] overflow-hidden rounded-full">
          {legs.map((l) => (
            <div key={l.label} className="h-3" style={{ background: l.color, flexBasis: `${(Number(l.amount) / (gross || 1)) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-6 space-y-3 text-sm">
          {legs.map((l) => (
            <li key={l.label} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              <div className="flex-1">
                <div className="font-medium">{l.label} ({l.pct})</div>
                {l.addr && <div className="font-mono text-[11px] text-black/50">{l.addr}</div>}
              </div>
              <div className="font-medium">{l.amount} {asset}</div>
            </li>
          ))}
        </ul>
      </section>

      {(batch.driverPayouts?.length ?? 0) > 0 && (
        <section className="overflow-hidden rounded-3xl bg-white">
          <div className="border-b border-black/5 p-6">
            <div className="text-sm font-semibold">Driver payouts</div>
            <div className="mt-1 text-xs text-black/50">
              {batch.driverPayouts.length} driver{batch.driverPayouts.length === 1 ? '' : 's'} — fanned out from
              driver_pool via SDP.
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-black/[.03] text-left text-[11px] uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Address</th>
                <th className="px-5 py-3">Tier</th>
                <th className="px-5 py-3">Multiplier</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {batch.driverPayouts.map((p) => (
                <tr key={p.userId}>
                  <td className="px-5 py-3">{p.userId}</td>
                  <td className="px-5 py-3 font-mono text-xs text-black/60">
                    {p.address.slice(0, 6)}…{p.address.slice(-6)}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-[#03C394]/25 px-2 py-0.5 text-[11px] font-medium text-[#032018]">
                      SCOUT{p.tier}
                    </span>
                  </td>
                  <td className="px-5 py-3">{p.multiplier.toFixed(1)}×</td>
                  <td className="px-5 py-3 text-right font-medium">{p.amount} {asset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Kv({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  const body = (
    <span className={`${mono ? 'font-mono text-xs' : ''} ${link ? 'text-blue-700 hover:underline' : 'text-black'} break-all`}>
      {value}
    </span>
  );
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-black/50">{label}</div>
      <div className="mt-1">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer">{body}</a> : body}
      </div>
    </div>
  );
}
