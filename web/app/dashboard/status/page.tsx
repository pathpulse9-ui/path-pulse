'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OpsStatusResponse, StatusAlert } from '@pathpulse/contract';
import { getOpsStatus } from '../../lib/api';
import { usePageActions } from '../../components/dashboard/PageActions';
import { T } from '../../components/dashboard/typography';
import { ErrorNotice } from '../../components/dashboard/ErrorNotice';

const POLL_MS = 15_000;

const CHECK_LABEL: Record<string, string> = {
  horizon: 'Stellar Horizon',
  database: 'Postgres',
  sdp: 'Disbursement Platform (SDP)',
};

const SEVERITY_CLASS: Record<StatusAlert['severity'], string> = {
  critical: 'bg-red-100 text-red-700 border-red-300',
  warning: 'bg-amber-100 text-amber-700 border-amber-300',
  resolved: 'bg-green-100 text-green-700 border-green-300',
};

const DELIVERY_LABEL: Record<StatusAlert['delivery'], string> = {
  sent: 'delivered to webhook',
  deduped: 'suppressed (duplicate)',
  disabled: 'not sent — no webhook',
  failed: 'webhook delivery failed',
};

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export default function StatusPage() {
  const [status, setStatus] = useState<OpsStatusResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setStatus(await getOpsStatus(refresh));
      setError(null);
    } catch (e) {
      setError(e ?? 'Failed to load status');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  usePageActions(
    () => (
      <button onClick={() => void load(true)} disabled={loading} className={T.buttonSecondary}>
        {loading ? 'Checking…' : 'Check now'}
      </button>
    ),
    [load, loading],
  );

  const report = status?.monitor.report;
  const down = report?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className={T.sectionStack}>
      {error != null && <ErrorNotice error={error} />}

      {report && (
        <div
          className={`rounded-2xl border p-6 ${
            report.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${report.ok ? 'bg-green-500' : 'bg-red-500'}`} />
            <h2 className={T.cardTitle}>
              {report.ok ? 'All systems operational' : `${down.length} of ${report.checks.length} checks failing`}
            </h2>
            <span className="ml-auto text-xs text-black/50">
              {report.network} · checked {ago(report.checkedAt, now)}
            </span>
          </div>
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {report.checks.map((c) => (
            <div key={c.name} className={`${T.card} space-y-2`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className={T.body}>{CHECK_LABEL[c.name] ?? c.name}</span>
                <span className={`ml-auto text-xs ${c.ok ? 'text-green-700' : 'text-red-700'}`}>
                  {c.ok ? 'Up' : 'Down'}
                </span>
              </div>
              <div className={T.metric}>{c.latencyMs} ms</div>
              {c.error && <p className="break-words text-xs text-red-700">{c.error}</p>}
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className={`${T.card} space-y-4`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <h2 className={T.cardTitle}>Alerting</h2>
              <p className={`${T.cardDescription} mt-1`}>
                The backend re-checks every {Math.round(status.monitor.intervalMs / 1000)}s and alerts when a
                dependency goes down or recovers, and on any server error. Repeats of the same alert are suppressed for{' '}
                {status.alerting.dedupeWindowMinutes} minutes.
              </p>
            </div>
            <span
              className={`self-start rounded-full border px-3 py-1 text-xs ${
                status.alerting.webhookConfigured
                  ? 'border-green-300 bg-green-100 text-green-700'
                  : 'border-amber-300 bg-amber-100 text-amber-700'
              }`}
            >
              {status.alerting.webhookConfigured ? 'Webhook connected' : 'No webhook — alerts are only logged'}
            </span>
          </div>

          {status.alerts.length === 0 ? (
            <p className={T.bodyMuted}>No alerts since the backend started {ago(status.startedAt, now)}.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {status.alerts.map((a) => (
                <li key={`${a.at}-${a.key}-${a.severity}`} className="flex flex-wrap items-start gap-3 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASS[a.severity]}`}>
                    {a.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={T.body}>{a.title}</div>
                    {a.detail && <div className="break-words text-xs text-black/50">{a.detail}</div>}
                  </div>
                  <div className="text-right text-xs text-black/50">
                    <div>{ago(a.at, now)}</div>
                    <div className={a.delivery === 'failed' ? 'text-red-700' : ''}>{DELIVERY_LABEL[a.delivery]}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-black/40">
            History is kept in memory and resets when the backend restarts (v{status.version}, up since{' '}
            {new Date(status.startedAt).toLocaleString()}).
          </p>
        </div>
      )}
    </div>
  );
}
