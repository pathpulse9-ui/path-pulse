'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { SettlementBatch, OffRampSession } from '@pathpulse/contract';
import { listSettlementBatches, listOffRampSessions } from '../lib/api';
import { usePageActions } from '../components/dashboard/PageActions';
import { T } from '../components/dashboard/typography';

const SERIES = [
  { key: 'authorities', label: 'Authorities', pct: '50%', color: '#2563EB' },
  { key: 'driverRewards', label: 'Driver rewards', pct: '30%', color: '#D97706' },
  { key: 'treasury', label: 'Treasury', pct: '20%', color: '#0D9488' },
] as const;

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface DayBucket {
  day: string;
  label: string;
  authorities: number;
  driverRewards: number;
  treasury: number;
  total: number;
}

function bucketByDay(batches: SettlementBatch[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const b of batches) {
    const day = b.createdAt.slice(0, 10);
    const cur =
      map.get(day) ??
      {
        day,
        label: new Date(b.createdAt).toLocaleDateString('en-US', { weekday: 'short' }),
        authorities: 0,
        driverRewards: 0,
        treasury: 0,
        total: 0,
      };
    cur.authorities += Number(b.split.authorities);
    cur.driverRewards += Number(b.split.driverRewards);
    cur.treasury += Number(b.split.treasury);
    cur.total += Number(b.grossAmount);
    map.set(day, cur);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-7);
}

export default function DashboardOverview() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [sessions, setSessions] = useState<OffRampSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, s] = await Promise.all([
        listSettlementBatches(50),
        listOffRampSessions(50).catch(() => ({ items: [], nextCursor: null })),
      ]);
      setBatches(b.items);
      setSessions(s.items);
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

  const days = bucketByDay(batches);
  const peak = Math.max(...days.map((d) => d.total), 0);
  const totals = batches.reduce(
    (acc, b) => ({
      gross: acc.gross + Number(b.grossAmount),
      authorities: acc.authorities + Number(b.split.authorities),
      driverRewards: acc.driverRewards + Number(b.split.driverRewards),
      treasury: acc.treasury + Number(b.split.treasury),
    }),
    { gross: 0, authorities: 0, driverRewards: 0, treasury: 0 },
  );
  const drivers = batches.reduce((n, b) => n + b.driverPayouts.length, 0);

  usePageActions(
    () => (
      <button onClick={load} disabled={loading} className={T.buttonSecondary}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    ),
    [load, loading],
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl bg-white p-6">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl bg-white p-6">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="text-4xl font-medium text-black tracking-[-0.03em]">
                {fmt(totals.gross)} <span className="text-2xl text-black/40">XLM</span>
              </div>
              <p className="text-sm text-black/50 mt-1">
                Settled across {batches.length} batch{batches.length === 1 ? '' : 'es'}
              </p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {SERIES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-2 text-sm text-black/60">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          {days.length === 0 ? (
            <div className="rounded-xl border border-dashed border-black/15 p-10 text-center">
              <p className="font-medium text-black">No settlement activity yet</p>
              <p className="text-sm text-black/50 mt-1">
                Run a settlement batch and this chart fills from on-chain results.
              </p>
              <Link
                href="/dashboard/settlement"
                className="inline-flex items-center mt-4 h-10 px-6 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors duration-200"
              >
                Go to Settlement
              </Link>
            </div>
          ) : (
            <div className="relative flex items-end gap-3 h-56">
              {days.map((d, i) => (
                <div
                  key={d.day}
                  className="flex-1 h-full flex flex-col justify-end items-center gap-2"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className="w-full max-w-[56px] flex flex-col justify-end gap-0.5 transition-opacity duration-200"
                    style={{
                      height: `${peak > 0 ? (d.total / peak) * 100 : 0}%`,
                      opacity: hovered === null || hovered === i ? 1 : 0.45,
                    }}
                  >
                    {SERIES.map((s, si) => (
                      <div
                        key={s.key}
                        style={{
                          backgroundColor: s.color,
                          height: `${d.total > 0 ? (d[s.key] / d.total) * 100 : 0}%`,
                          borderRadius: si === 0 ? '4px 4px 0 0' : 0,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-black/40">{d.label}</span>
                  {hovered === i && (
                    <div className="absolute bottom-full mb-2 z-10 rounded-xl bg-white border border-black/10 shadow-lg px-3 py-2 text-xs whitespace-nowrap">
                      <div className="text-black/50 mb-1">
                        {new Date(d.day).toLocaleDateString('en-US', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                      {SERIES.map((s) => (
                        <div key={s.key} className="flex items-center gap-2 text-black/70">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.label}
                          <span className="ml-auto pl-4 text-black">{fmt(d[s.key])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 flex flex-col justify-between gap-6">
          {SERIES.map((s) => (
            <div key={s.key}>
              <div className="flex items-center gap-2 text-sm text-black/50">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label} · {s.pct}
              </div>
              <div
                className="text-2xl font-medium text-black tracking-[-0.02em] mt-1"
              >
                {fmt(totals[s.key])} XLM
              </div>
            </div>
          ))}
          <div className="border-t border-black/5 pt-4">
            <div className="text-sm text-black/50">Driver payouts</div>
            <div className="text-2xl font-medium text-black mt-1">{drivers}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white p-6">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em] mb-1">
            Split composition
          </h2>
          <p className="text-sm text-black/50 mb-5">Share of all settled volume to date.</p>
          {totals.gross === 0 ? (
            <p className="text-sm text-black/40">No volume settled yet.</p>
          ) : (
            <>
              <div className="flex gap-0.5 h-3 mb-5">
                {SERIES.map((s) => (
                  <div
                    key={s.key}
                    className="first:rounded-l-full last:rounded-r-full"
                    style={{
                      backgroundColor: s.color,
                      width: `${(totals[s.key] / totals.gross) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <div className="space-y-3">
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-3 text-sm">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-black/70">{s.label}</span>
                    <span className="ml-auto text-black/50">{fmt(totals[s.key])} XLM</span>
                    <span className="w-12 text-right text-black">
                      {((totals[s.key] / totals.gross) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
              Recent activity
            </h2>
            <Link
              href="/dashboard/settlement"
              className="text-sm text-black/50 hover:text-black transition-colors duration-200"
            >
              View all
            </Link>
          </div>
          {batches.length === 0 && sessions.length === 0 ? (
            <p className="text-sm text-black/40">Nothing settled or withdrawn yet.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {batches.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium flex items-center justify-center shrink-0">
                    ST
                  </span>
                  <div className="min-w-0">
                    <div className="text-black truncate">Settlement batch</div>
                    <div className="text-xs text-black/40 font-mono">{short(b.txHash)}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-black">{fmt(Number(b.grossAmount))} XLM</div>
                    <div className="text-xs text-black/40">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
              {sessions.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 text-xs font-medium flex items-center justify-center shrink-0">
                    OR
                  </span>
                  <div className="min-w-0">
                    <div className="text-black truncate">Off-ramp · {s.fiatCurrency}</div>
                    <div className="text-xs text-black/40">{s.status}</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-black">
                      {fmt(Number(s.amount))} {s.asset.code}
                    </div>
                    <div className="text-xs text-black/40">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
