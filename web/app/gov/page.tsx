'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  SettlementBatch,
  TreasuryConfig,
  DistributionAccount,
} from '@pathpulse/contract';
import {
  listSettlementBatches,
  getTreasuryConfig,
  listDistributionAccounts,
} from '../lib/api';

/**
 * D8 overview — landing card + KPI tiles + treasury multisig health + the
 * three distribution accounts, so a regulator sees the whole picture in one
 * screen and can jump into any drill-down.
 */
export default function GovOverviewPage() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [treasury, setTreasury] = useState<TreasuryConfig | null>(null);
  const [accounts, setAccounts] = useState<DistributionAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [b, t, a] = await Promise.all([
          listSettlementBatches({ limit: 100 }),
          getTreasuryConfig(),
          listDistributionAccounts(),
        ]);
        setBatches(b.items);
        setTreasury(t);
        setAccounts(a);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const gross = batches.reduce((s, b) => s + Number(b.grossAmount), 0);
  const auth  = batches.reduce((s, b) => s + Number(b.split.authorities), 0);
  const driv  = batches.reduce((s, b) => s + Number(b.split.driverRewards), 0);
  const trez  = batches.reduce((s, b) => s + Number(b.split.treasury), 0);
  const drivers = batches.reduce((s, b) => s + (b.driverPayouts?.length ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settlement, made verifiable</h1>
        <p className="mt-2 max-w-2xl text-sm text-black/60">
          Every batch below settles to Stellar in one atomic transaction. Each row is a Horizon
          hash you can independently check.
        </p>
      </div>

      {error && (
        <div className="rounded-3xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard label="Total settled" value={fmt(gross)} unit="XLM" />
        <KpiCard label="Batches"       value={String(batches.length)} />
        <KpiCard label="Driver payouts" value={String(drivers)} />
        <KpiCard
          label="Treasury multisig"
          value={
            treasury
              ? `${treasury.thresholds.high}-of-${treasury.signers.filter((s) => s.weight > 0).length}`
              : '—'
          }
          sublabel="active signers"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="col-span-1 rounded-3xl bg-white p-6">
          <div className="text-sm font-semibold">Split composition</div>
          <div className="mt-1 text-xs text-black/50">Share of total settled volume.</div>
          <div className="mt-6 flex h-3 gap-[2px] overflow-hidden rounded-full">
            <div className="bg-[#03C394]" style={{ flexBasis: `${pct(auth, gross)}%` }} />
            <div className="bg-[#03C394]/60" style={{ flexBasis: `${pct(driv, gross)}%` }} />
            <div className="bg-[#03C394]/25" style={{ flexBasis: `${pct(trez, gross)}%` }} />
          </div>
          <ul className="mt-5 space-y-2 text-sm">
            <LegendRow color="#03C394"       label="Authorities (50%)"    amount={auth} />
            <LegendRow color="rgba(3,195,148,.60)" label="Driver rewards (30%)" amount={driv} />
            <LegendRow color="rgba(3,195,148,.25)" label="Treasury (20%)"       amount={trez} />
          </ul>
        </div>

        <div className="col-span-1 rounded-3xl bg-white p-6 md:col-span-2">
          <div className="text-sm font-semibold">Distribution accounts</div>
          <div className="mt-1 text-xs text-black/50">
            The three on-chain destinations of every 50 / 30 / 20 split.
          </div>
          <ul className="mt-5 divide-y divide-black/5">
            {accounts.map((a) => (
              <li key={a.role} className="flex items-center gap-4 py-3">
                <RoleBadge role={a.role} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{roleLabel(a.role)}</div>
                  <div className="font-mono text-xs text-black/60 truncate">{a.publicKey}</div>
                </div>
                {a.multisig && (
                  <span className="rounded-full bg-[#03C394]/25 px-2 py-0.5 text-[11px] font-medium text-[#032018]">
                    multisig
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-3xl bg-white p-6">
        <div className="flex items-center">
          <div>
            <div className="text-sm font-semibold">Recent batches</div>
            <div className="mt-1 text-xs text-black/50">Latest 5. Full list under Settlements.</div>
          </div>
          <Link
            href="/gov/settlements"
            className="ml-auto rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/85"
          >
            View all →
          </Link>
        </div>
        <ul className="mt-5 divide-y divide-black/5">
          {batches.slice(0, 5).map((b) => (
            <li key={b.id} className="flex items-center gap-4 py-3">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-blue-50 text-[10px] font-semibold text-blue-700">
                ST
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/gov/settlements/${b.id}`} className="text-sm font-medium hover:underline">
                  {b.grossAmount} {b.asset.code}
                </Link>
                <div className="font-mono text-[11px] text-black/50 truncate">{shortHash(b.txHash)}</div>
              </div>
              <div className="text-xs text-black/40">{b.createdAt.slice(0, 10)}</div>
            </li>
          ))}
          {batches.length === 0 && !error && (
            <li className="py-8 text-center text-sm text-black/40">No settlements yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function KpiCard({ label, value, unit, sublabel }: { label: string; value: string; unit?: string; sublabel?: string }) {
  return (
    <div className="rounded-3xl bg-white p-5">
      <div className="text-xs uppercase tracking-wide text-black/50">{label}</div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="text-2xl font-semibold">{value}</div>
        {unit && <div className="text-sm text-black/40">{unit}</div>}
      </div>
      {sublabel && <div className="mt-1 text-[11px] text-black/40">{sublabel}</div>}
    </div>
  );
}

function LegendRow({ color, label, amount }: { color: string; label: string; amount: number }) {
  return (
    <li className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-black/70">{label}</span>
      <span className="font-medium">{fmt(amount)} XLM</span>
    </li>
  );
}

function RoleBadge({ role }: { role: DistributionAccount['role'] }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    partner_revenue: { bg: '#03C394',            fg: '#032018', text: '50' },
    driver_pool:     { bg: 'rgba(3,195,148,.60)', fg: '#032018', text: '30' },
    treasury:        { bg: 'rgba(3,195,148,.25)', fg: '#032018', text: '20' },
  };
  const s = map[role] ?? { bg: '#f3f4f6', fg: '#000', text: '?' };
  return (
    <div
      className="grid h-8 w-8 place-items-center rounded-md text-[11px] font-bold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.text}
    </div>
  );
}

function roleLabel(role: DistributionAccount['role']): string {
  switch (role) {
    case 'partner_revenue': return 'Authorities (50%)';
    case 'driver_pool':     return 'Driver pool (30%)';
    case 'treasury':        return 'Treasury (20%)';
    default:                return role;
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}
function shortHash(h: string): string {
  return h.length <= 12 ? h : `${h.slice(0, 6)}…${h.slice(-6)}`;
}
