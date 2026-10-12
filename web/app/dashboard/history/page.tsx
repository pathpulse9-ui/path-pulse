'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { OffRampSession, OffRampStatus } from '@pathpulse/contract';
import type { OffRampStatusEvent, OnRampSession } from '../../lib/api';
import {
  getOffRampSessionEvents,
  getOnrampSession,
  listOffRampSessions,
  listOnrampSessions,
} from '../../lib/api';
import { ErrorNotice } from '../../components/dashboard/ErrorNotice';

/**
 * Driver activity history. Unified chronological list of every off-ramp and
 * on-ramp session the driver has placed, with filterable status / direction
 * and an expandable per-session event log sourced from
 * `off_ramp_status_events`. The log is the T2-recovery evidence the reviewer
 * saw inline on the off-ramp page — exposed here so a driver (or an auditor)
 * can inspect any historical session without clicking through from off-ramp.
 */

type Direction = 'all' | 'off' | 'on';
type StatusFilter = 'all' | OffRampStatus | 'open' | 'filled' | 'cancelled';

interface Row {
  id: string;
  direction: 'off' | 'on';
  status: string;
  amount: string;
  asset: string;
  fiatCurrency: string;
  fiatAmount?: string;
  settlementBatchId?: string | null;
  createdAt: string;
  provider: string;
  raw: OffRampSession | OnRampSession;
}

const short = (s?: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '—');

function statusClasses(s: string) {
  const n = s.toLowerCase();
  if (n === 'completed' || n === 'filled') return 'bg-green-100 text-green-700 border-green-300';
  if (n === 'error' || n.includes('cancel')) return 'bg-red-100 text-red-700 border-red-300';
  if (n === 'pending_anchor' || n === 'partially_filled') return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-amber-100 text-amber-700 border-amber-300';
}

export default function HistoryPage() {
  const [off, setOff] = useState<OffRampSession[] | null>(null);
  const [on, setOn] = useState<OnRampSession[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<Direction>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, n] = await Promise.all([
        listOffRampSessions(200).then((p) => p.items).catch(() => []),
        listOnrampSessions(200).then((p) => p.items).catch(() => []),
      ]);
      setOff(o);
      setOn(n);
    } catch (e) {
      setError(e ?? 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows: Row[] = useMemo(() => {
    const items: Row[] = [];
    for (const s of off ?? []) {
      items.push({
        id: s.id,
        direction: 'off',
        status: s.status,
        amount: s.amount,
        asset: s.asset.code,
        fiatCurrency: s.fiatCurrency ?? 'INR',
        fiatAmount: s.fiatAmountEstimate,
        settlementBatchId: s.settlementBatchId,
        createdAt: s.createdAt,
        provider: s.provider,
        raw: s,
      });
    }
    for (const s of on ?? []) {
      items.push({
        id: s.id,
        direction: 'on',
        status: s.status,
        amount: s.amount,
        asset: 'INR',
        fiatCurrency: s.asset,
        fiatAmount: s.cryptoAmount,
        settlementBatchId: null,
        createdAt: s.createdAt,
        provider: s.provider,
        raw: s,
      });
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }, [off, on]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (direction !== 'all' && r.direction !== direction) return false;
      if (status !== 'all' && r.status.toLowerCase() !== status) return false;
      return true;
    });
  }, [rows, direction, status]);

  const counts = useMemo(() => ({
    all: rows.length,
    off: rows.filter((r) => r.direction === 'off').length,
    on: rows.filter((r) => r.direction === 'on').length,
  }), [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-[-0.02em] text-black">History</h1>
        <p className="text-sm text-black/60 mt-1">
          Every off-ramp and on-ramp session, newest first. Click a row to inspect its full
          status-event log.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-4 flex items-center gap-3 flex-wrap">
        <FilterChip label={`All (${counts.all})`} active={direction === 'all'} onClick={() => setDirection('all')} />
        <FilterChip label={`Off-ramp (${counts.off})`} active={direction === 'off'} onClick={() => setDirection('off')} />
        <FilterChip label={`On-ramp (${counts.on})`} active={direction === 'on'} onClick={() => setDirection('on')} />
        <div className="w-px h-5 bg-black/10 mx-1" />
        <StatusDropdown value={status} onChange={setStatus} />
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error != null && <ErrorNotice error={error} />}

      {loading && rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-sm text-black/40 text-center">
          Loading your activity…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-sm text-black/50 text-center">
          No activity {direction === 'all' ? 'yet' : `in this filter`}.{' '}
          <Link href="/dashboard/offramp" className="underline">Start a withdrawal</Link>{' '}or{' '}
          <Link href="/dashboard/onramp" className="underline">top up</Link>.
        </div>
      ) : (
        <div className="rounded-2xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
                <th className="py-3 px-5 font-medium">When</th>
                <th className="py-3 px-5 font-medium">Direction</th>
                <th className="py-3 px-5 font-medium">Amount</th>
                <th className="py-3 px-5 font-medium">Settles into</th>
                <th className="py-3 px-5 font-medium">Status</th>
                <th className="py-3 px-5 font-medium">Batch</th>
                <th className="py-3 px-5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <HistoryRow
                  key={`${r.direction}-${r.id}`}
                  row={r}
                  expanded={expanded === `${r.direction}-${r.id}`}
                  onToggle={() => setExpanded((cur) => (cur === `${r.direction}-${r.id}` ? null : `${r.direction}-${r.id}`))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-black text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
      }`}
    >
      {label}
    </button>
  );
}

function StatusDropdown({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <label className="text-xs text-black/60 flex items-center gap-2">
      Status
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as StatusFilter)}
        className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black focus:outline-none focus:border-black/30"
      >
        <option value="all">All</option>
        <option value="pending_user_transfer_start">Awaiting transfer</option>
        <option value="pending_anchor">Converting</option>
        <option value="completed">Completed</option>
        <option value="filled">Filled</option>
        <option value="partially_filled">Partially filled</option>
        <option value="cancelled">Cancelled</option>
        <option value="error">Error</option>
      </select>
    </label>
  );
}

function HistoryRow({ row, expanded, onToggle }: { row: Row; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-black/5 cursor-pointer hover:bg-black/[0.02] transition-colors"
      >
        <td className="py-3 px-5 whitespace-nowrap">
          <div className="text-black">{new Date(row.createdAt).toLocaleDateString()}</div>
          <div className="text-xs text-black/40">{new Date(row.createdAt).toLocaleTimeString()}</div>
        </td>
        <td className="py-3 px-5">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            row.direction === 'off' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {row.direction === 'off' ? 'Off-ramp' : 'On-ramp'}
          </span>
        </td>
        <td className="py-3 px-5">
          <div className="text-black">{row.amount} {row.asset}</div>
          {row.fiatAmount && (
            <div className="text-xs text-black/40">
              {row.direction === 'off' ? '→' : '='} {row.fiatAmount} {row.fiatCurrency}
            </div>
          )}
        </td>
        <td className="py-3 px-5 text-black/60">
          {row.direction === 'off' ? row.fiatCurrency : row.fiatCurrency + ' trading wallet'}
        </td>
        <td className="py-3 px-5">
          <span className={`text-xs rounded-full border px-2 py-0.5 ${statusClasses(row.status)}`}>
            {row.status.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="py-3 px-5 font-mono text-xs text-black/60">
          {row.settlementBatchId ? short(row.settlementBatchId) : '—'}
        </td>
        <td className="py-3 px-5 text-right">
          <span className="text-black/30 text-xs">{expanded ? '▴' : '▾'}</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-black/[0.02] px-5 py-4">
            <SessionDrilldown row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function SessionDrilldown({ row }: { row: Row }) {
  if (row.direction === 'off') return <OffRampEventLog sessionId={row.id} />;
  return <OnRampSnapshot sessionId={row.id} />;
}

function OffRampEventLog({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<OffRampStatusEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    getOffRampSessionEvents(sessionId)
      .then((r) => { if (!cancelled) setEvents(r.events); })
      .catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) return <ErrorNotice error={error} />;
  if (!events) return <div className="text-xs text-black/40">Loading event log…</div>;
  if (events.length === 0) return <div className="text-xs text-black/40">No events recorded.</div>;

  const badge = (s: string) => {
    switch (s) {
      case 'placed':
      case 'create':     return 'bg-black/5 text-black/80';
      case 'webhook':    return 'bg-blue-100 text-blue-700';
      case 'poll':       return 'bg-amber-100 text-amber-800';
      case 'reconciler': return 'bg-emerald-100 text-emerald-800';
      case 'client':     return 'bg-fuchsia-100 text-fuchsia-800';
      default:           return 'bg-black/5 text-black/60';
    }
  };

  return (
    <div>
      <div className="text-xs text-black/50 mb-2">
        Status events ({events.length}) — append-only, source-tagged
      </div>
      <ol className="space-y-1.5">
        {events.map((e, i) => (
          <li key={e.id} className="flex items-start gap-3 text-sm">
            <span className="text-black/30 tabular-nums w-6 text-right">{i + 1}.</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge(e.source)}`}>
              {e.source}
            </span>
            <span className="text-black/80 font-mono text-xs">
              {e.mappedStatus ?? '(no status change)'}
            </span>
            {e.carretStatus && (
              <span className="text-black/40 text-xs">← {e.carretStatus}</span>
            )}
            <span className="ml-auto text-black/40 text-xs">
              {new Date(e.receivedAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function OnRampSnapshot({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<OnRampSession | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    getOnrampSession(sessionId)
      .then((s) => { if (!cancelled) setData(s); })
      .catch((e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) return <ErrorNotice error={error} />;
  if (!data) return <div className="text-xs text-black/40">Loading session…</div>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <Snap label="Order id" value={data.id} mono />
      <Snap label="Carret bank" value={data.bankLast4 ? `••${data.bankLast4}` : '—'} />
      <Snap label="Status" value={data.status.replace(/_/g, ' ')} />
      <Snap label="Placed at" value={new Date(data.createdAt).toLocaleString()} />
    </div>
  );
}

function Snap({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-black/40">{label}</div>
      <div className={`text-black ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
