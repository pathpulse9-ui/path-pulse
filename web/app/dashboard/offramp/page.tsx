'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CarretLimits, CarretResumeResponse, CarretBank, CarretWalletBalance,
  OffRampSessionEvents, ReconcileResult,
} from '../../lib/api';
import {
  getCarretLimits, resumeCarretKyc, listCarretBanks, registerCarretBank, listCarretWallets,
  getOffRampSessionEvents, reconcileOfframpOnce, simulateMissedWebhook,
} from '../../lib/api';
import type {
  OffRampSession,
  OffRampStatus,
  OffRampQuote,
  OpsOffRampSession,
  OffRampStatusEventRecord,
  ReconcileReportRecord,
} from '@pathpulse/contract';
import {
  listOpsOffRampSessions,
  getOpsOffRampEvents,
  runOffRampReconcile,
  listOffRampSessions,
  getOffRampSession,
  createOffRampWithdrawal,
  getOffRampQuote,
} from '../../lib/api';
import { useIdempotencyKey } from '../../lib/idempotency';
import { ErrorNotice } from '../../components/dashboard/ErrorNotice';
import Link from 'next/link';

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
  const runWithdrawal = useIdempotencyKey();
  const [selected, setSelected] = useState<OffRampSession | null>(null);
  const [amount, setAmount] = useState('10');
  const [batchId, setBatchId] = useState('');
  const [opsSessions, setOpsSessions] = useState<OpsOffRampSession[] | null>(null);
  const [opsError, setOpsError] = useState<unknown>(null);
  const [reconciling, setReconciling] = useState(false);
  const [report, setReport] = useState<ReconcileReportRecord | null>(null);
  const [timeline, setTimeline] = useState<{ id: string; events: OffRampStatusEventRecord[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<OffRampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  // PAT-80: Carret daily limit for this driver's sub-account.
  const [limits, setLimits] = useState<CarretLimits | null>(null);
  useEffect(() => {
    getCarretLimits().then(setLimits).catch(() => setLimits(null));
  }, []);

  // Gate the withdrawal form on KYC status. Resume is authoritative — the
  // backend refreshes from Carret on every call, so a driver who KYC-d in
  // another surface (mobile app, dashboard) sees the form unlock as soon as
  // Carret marks them verified. Null while loading, then verified/pending/
  // rejected/re_kyc/manual_review.
  const [resume, setResume] = useState<CarretResumeResponse | null | 'loading'>('loading');
  useEffect(() => {
    resumeCarretKyc().then((r) => setResume(r)).catch(() => setResume(null));
  }, []);
  const kycVerified = resume && resume !== 'loading' && resume.kycStatus === 'verified';
  const kycLoading  = resume === 'loading';

  // Registered banks — the driver's own IFSC + a/c that INR settles to.
  // Fetched only once KYC is verified; a driver without a verified KYC
  // isn't allowed to add a bank on Carret's side anyway.
  const [banks, setBanks] = useState<CarretBank[] | null>(null);
  const banksLoading = kycVerified && banks === null;
  useEffect(() => {
    if (!kycVerified) return;
    listCarretBanks()
      .then((r) => setBanks(r.items ?? []))
      .catch(() => setBanks([]));
  }, [kycVerified]);
  const hasVerifiedBank = (banks ?? []).some((b) => b.status === 'verified');
  const hasAnyBank      = (banks ?? []).length > 0;

  // Trading wallet balance chip — surfaces "9.00 USDC available" so the
  // driver sees the ceiling before typing an amount they can't withdraw.
  const [wallets, setWallets] = useState<CarretWalletBalance[] | null>(null);
  useEffect(() => {
    if (!kycVerified) return;
    listCarretWallets()
      .then((r) => setWallets(r.items ?? []))
      .catch(() => setWallets([]));
  }, [kycVerified]);
  const usdc = (wallets ?? []).find((w) => w.asset?.toUpperCase() === 'USDC');
  const usdcAvailable = usdc ? Number(usdc.available ?? usdc.balance) : null;

  const load = useCallback(async () => {
    try {
      const page = await listOffRampSessions(50);
      setSessions(page.items);
      setSelected((cur) => (cur ? page.items.find((s) => s.id === cur.id) ?? cur : page.items[0] ?? null));
    } catch (e) {
      setError(e ?? 'Failed to reach Backend Core');
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
          setQuoteError(e ?? 'Quote failed');
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
      const withdrawal = { amount, settlementBatchId: batchId.trim() };
      const session = await runWithdrawal(withdrawal, (key) => createOffRampWithdrawal(withdrawal, key));
      setSelected(session);
      await load();
    } catch (e) {
      setError(e ?? 'Failed to start withdrawal');
    } finally {
      setBusy(false);
    }
  }

  const loadOps = useCallback(async () => {
    setOpsError(null);
    try {
      setOpsSessions((await listOpsOffRampSessions()).items);
    } catch (e) {
      setOpsSessions(null);
      setOpsError(e);
    }
  }, []);

  const reconcile = useCallback(async () => {
    setReconciling(true);
    setOpsError(null);
    try {
      setReport(await runOffRampReconcile());
      await loadOps();
    } catch (e) {
      setOpsError(e);
    } finally {
      setReconciling(false);
    }
  }, [loadOps]);

  const showTimeline = useCallback(async (id: string) => {
    setOpsError(null);
    try {
      setTimeline({ id, events: (await getOpsOffRampEvents(id)).events });
    } catch (e) {
      setOpsError(e);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* KYC gate. Withdrawals are blocked until Carret marks this driver
          verified. Backend /v1/carret/resume is authoritative — refreshed
          live on every call — so users who KYC-d in another surface see
          this unlock immediately. */}
      {kycLoading && (
        <div className="rounded-2xl bg-white p-6 text-sm text-black/50">
          Checking your KYC status…
        </div>
      )}
      {!kycLoading && !kycVerified && (
        <div className="rounded-2xl bg-white p-6 flex items-start gap-4">
          <div className="grid place-items-center h-10 w-10 rounded-full bg-black/5 shrink-0">🔒</div>
          <div className="flex-1">
            <p className="text-black font-medium tracking-[-0.02em]">
              {resume?.kycStatus === 'rejected' || (resume?.kycStatus as string) === 're_kyc'
                ? "We couldn't verify your last KYC — try again"
                : resume?.kycStatus === 'manual_review'
                ? 'Your KYC is under manual review at Carret'
                : resume?.kycStatus === 'pending'
                ? 'Finish your KYC to unlock withdrawals'
                : 'Verify your identity to unlock withdrawals'}
            </p>
            <p className="text-sm text-black/60 mt-1">
              A one-time check with Carret Infra: PAN photo, one more ID, and a selfie. Takes ~3 minutes.
            </p>
          </div>
          <Link
            href="/dashboard/kyc"
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium ${
              resume?.kycStatus === 'manual_review'
                ? 'bg-black/5 text-black/60 pointer-events-none'
                : 'bg-black text-white hover:bg-gray-800 transition-colors'
            }`}
          >
            {resume?.kycStatus === 'rejected' || (resume?.kycStatus as string) === 're_kyc'
              ? 'Retry'
              : resume?.kycStatus === 'manual_review'
              ? 'In review'
              : resume?.kycStatus === 'pending'
              ? 'Continue'
              : 'Start'}
          </Link>
        </div>
      )}

      {/* Bank gate. Once KYC is verified we still need at least one bank on
          the account before Carret's /place_order/ will accept the trade.
          The shared env bank is a sandbox convenience — flip it off in prod
          and every driver adds their own bank here first. */}
      {kycVerified && !banksLoading && !hasAnyBank && (
        <BankRegistrationCard
          onRegistered={(b) => setBanks((cur) => [...(cur ?? []), b])}
        />
      )}
      {kycVerified && !banksLoading && hasAnyBank && !hasVerifiedBank && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 flex items-start gap-4">
          <div className="grid place-items-center h-10 w-10 rounded-full bg-amber-100 shrink-0">🕒</div>
          <div className="flex-1">
            <p className="font-medium tracking-[-0.02em] text-amber-900">Bank pending verification</p>
            <p className="text-sm text-amber-800/80 mt-1">
              Carret is running a ₹1 penny-drop against your account. Usually clears within a minute.
              Refresh to check.
            </p>
          </div>
        </div>
      )}
      {kycVerified && hasVerifiedBank && (
        <BanksList banks={banks!} />
      )}

      <div className={`rounded-2xl bg-white p-6 space-y-4 ${!kycVerified || !hasVerifiedBank ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
            Start a withdrawal
          </h2>
          {usdcAvailable != null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-medium px-3 py-1 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {usdcAvailable.toFixed(2)} USDC available
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-sm">
            <span className="block text-black/50 mb-1 flex items-center gap-2">
              <span>Amount (USDC)</span>
              {usdcAvailable != null && usdcAvailable > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(usdcAvailable.toFixed(2))}
                  className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900"
                >
                  Max
                </button>
              )}
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 py-2 text-sm w-32 focus:outline-none focus:border-black/30"
            />
          </label>
          <label className="text-sm flex-1 min-w-48">
            <span className="block text-black/50 mb-1">Settlement batch ID (required)</span>
            <input
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              placeholder="stl_… (the settlement this withdrawal draws from)"
              className="rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 py-2 text-sm w-full font-mono focus:outline-none focus:border-black/30"
            />
          </label>
          <button
            onClick={startWithdrawal}
            disabled={busy || !batchId.trim()}
            className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Sell to fiat'}
          </button>
        </div>
        {error != null && <ErrorNotice error={error} />}

        {quoteError != null && <ErrorNotice error={quoteError} />}

        {limits && (
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${
              limits.remaining.withdraw_inr > 0
                ? 'bg-[#03C394]/12 text-[#032018]'
                : 'bg-red-100 text-red-700'
            }`}>
              ₹{limits.remaining.withdraw_inr.toLocaleString('en-IN')} available today
            </span>
            <span className="text-black/40">
              of ₹{limits.dailyCapInr.toLocaleString('en-IN')} Carret daily withdraw cap
            </span>
          </div>
        )}

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
                    ? `live quote · ${quote.provider}${quote.quoteId ? ` · #${quote.quoteId}` : ''}`
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

      {selected && (
        <ReconcilerEvidence sessionId={selected.id} />
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

      <div className="rounded-2xl bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
              Operator — off-ramp reconciliation
            </h2>
            <p className="text-xs text-black/50 mt-1">
              Every session, not only your own. The reconciler also runs automatically every 60s.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadOps}
              className="text-sm font-medium px-4 py-2 rounded-full border border-black/15 hover:bg-black/5 transition-colors duration-200"
            >
              Load sessions
            </button>
            <button
              onClick={reconcile}
              disabled={reconciling}
              className="bg-black text-white text-sm font-medium px-5 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
            >
              {reconciling ? 'Reconciling…' : 'Run reconciliation'}
            </button>
          </div>
        </div>

        {opsError != null && <ErrorNotice error={opsError} />}

        {report && (
          <div className="rounded-xl border border-black/10 p-4 space-y-2">
            <div className="flex gap-4 text-xs">
              <span>scanned <b>{report.scanned}</b></span>
              <span className="text-green-700">recovered <b>{report.recovered}</b></span>
              <span className="text-black/50">unmatched <b>{report.unmatched}</b></span>
              <span className={report.failed ? 'text-red-700' : 'text-black/50'}>
                failed <b>{report.failed}</b>
              </span>
            </div>
            {report.outcomes.map((o) => (
              <div key={o.sessionId} className="text-xs font-mono text-black/70">
                {short(o.sessionId)} · {o.action}
                {o.to ? ` · ${o.from} → ${o.to}` : ''}
                {o.matchedBy ? ` · matched by ${o.matchedBy}` : ''}
                {o.settlementBatchId ? ` · batch ${short(o.settlementBatchId)}` : ''}
              </div>
            ))}
            {report.outcomes.length === 0 && (
              <p className="text-xs text-black/40">No sessions were due for reconciliation.</p>
            )}
          </div>
        )}

        {opsSessions && opsSessions.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
                <th className="py-2 font-medium">Session</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Settlement batch</th>
                <th className="py-2 font-medium">Carret order</th>
                <th className="py-2 font-medium">Events</th>
              </tr>
            </thead>
            <tbody>
              {opsSessions.map((o) => (
                <tr key={o.id} className="border-b border-black/5">
                  <td className="py-2 font-mono text-xs">
                    <button onClick={() => showTimeline(o.id)} className="underline hover:text-black">
                      {short(o.id)}
                    </button>
                  </td>
                  <td className="py-2">
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${statusClasses(o.status)}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="py-2">{o.amount} {o.assetCode}</td>
                  <td className="py-2 font-mono text-xs">
                    {o.settlementBatchId ? short(o.settlementBatchId) : '—'}
                  </td>
                  <td className="py-2 font-mono text-xs">{o.carretOrderId ?? '—'}</td>
                  <td className="py-2 text-xs text-black/50">{o.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {opsSessions && opsSessions.length === 0 && (
          <p className="text-sm text-black/40">No off-ramp sessions recorded yet.</p>
        )}

        {timeline && (
          <div className="rounded-xl border border-black/10 p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-black/50">Status events · {short(timeline.id)}</span>
              <button onClick={() => setTimeline(null)} className="text-xs text-black/40 hover:text-black">
                close
              </button>
            </div>
            {timeline.events.map((e, i) => (
              <div key={i} className="text-xs font-mono py-0.5">
                {e.createdAt} &nbsp; {e.previousStatus ?? '(none)'} → {e.status} &nbsp;
                <span className="text-black/45">[{e.source}]</span>
              </div>
            ))}
            {timeline.events.length === 0 && (
              <p className="text-xs text-black/40">No events recorded for this session.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reconciler evidence panel (D4 / T2) ─────────────────────────────
//
// For the selected off-ramp session, shows the full status-event log
// (placed → webhook* → poll* → reconciler*) and a "Force reconcile
// now" button so a reviewer can watch a missed webhook get healed
// live. This is the on-screen evidence for the reviewer's ask.

function ReconcilerEvidence({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<OffRampSessionEvents | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [lastResult, setLastResult] = useState<ReconcileResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setData(await getOffRampSessionEvents(sessionId));
    } catch (e) {
      setError(e ?? 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);
  useEffect(() => { void load(); }, [load]);

  async function reconcile() {
    setReconciling(true); setError(null);
    try {
      const r = await reconcileOfframpOnce();
      setLastResult(r);
      await load();
    } catch (e) {
      setError(e ?? 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  }

  async function simulate() {
    setSimulating(true); setError(null);
    try {
      await simulateMissedWebhook(sessionId);
      await load();
    } catch (e) {
      setError(e ?? 'Could not simulate missed webhook');
    } finally {
      setSimulating(false);
    }
  }

  const badge = (s: string) => {
    switch (s) {
      case 'placed':     return 'bg-black/5 text-black/80';
      case 'webhook':    return 'bg-blue-100 text-blue-700';
      case 'poll':       return 'bg-amber-100 text-amber-800';
      case 'reconciler': return 'bg-emerald-100 text-emerald-800';
      default:           return 'bg-black/5 text-black/60';
    }
  };

  const myDetail = lastResult?.details?.find((d) => d.sessionId === sessionId);

  return (
    <div className="rounded-2xl bg-white p-6 space-y-4 border border-emerald-100">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
            Reconciler evidence
          </h2>
          <p className="text-xs text-black/50 mt-1">
            D4 / T2 — durable status-event log for this session.
            {' '}<span className="font-mono">{sessionId}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-full border border-black/10 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={simulate}
            disabled={simulating}
            className="rounded-full border border-amber-300 bg-amber-50 text-amber-800 px-4 py-1.5 text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
            title="Roll this session back to pending — simulates a webhook Carret sent but we never received."
          >
            {simulating ? 'Simulating…' : 'Simulate missed webhook'}
          </button>
          <button
            onClick={reconcile}
            disabled={reconciling}
            className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {reconciling ? 'Reconciling…' : 'Force reconcile now'}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 space-y-1">
          <div>
            Last pass — scanned <b>{lastResult.scanned}</b>, healed <b>{lastResult.healed}</b>,
            unchanged <b>{lastResult.unchanged}</b>, failed <b>{lastResult.failed}</b>.
          </div>
          {myDetail && (
            <div>
              This session — {myDetail.outcome}
              {myDetail.from && myDetail.to && myDetail.from !== myDetail.to
                ? ` (${myDetail.from} → ${myDetail.to})`
                : ''}
              {myDetail.settlementBatchId ? ` · batch ${short(myDetail.settlementBatchId)}` : ''}
            </div>
          )}
        </div>
      )}

      {error != null && <ErrorNotice error={error} />}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-black/40 text-xs">Session status</div>
              <div className="font-medium">{data.session.status}</div>
            </div>
            <div>
              <div className="text-black/40 text-xs">Provider</div>
              <div>{data.session.provider}</div>
            </div>
            <div>
              <div className="text-black/40 text-xs">Settlement batch</div>
              <div className="font-mono text-xs">
                {data.session.settlementBatchId ? short(data.session.settlementBatchId) : '—'}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-black/[0.02] border border-black/5 p-4">
            <div className="text-xs text-black/50 mb-2">
              Status events ({data.events.length}) — append-only, source-tagged
            </div>
            {data.events.length === 0 ? (
              <div className="text-sm text-black/40">No events yet.</div>
            ) : (
              <ol className="space-y-2">
                {data.events.map((e, i) => (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bank registration card ──────────────────────────────────────────
//
// Inline form the driver fills once per Carret sub-account. IFSC is
// standardised (^[A-Z]{4}0[A-Z0-9]{6}$) so we can validate client-side
// before the round-trip; account numbers are 9-18 digits per RBI. Name
// is what appears on the passbook — Carret's penny-drop compares it
// against the bank-side record.

function BankRegistrationCard({ onRegistered }: { onRegistered: (b: CarretBank) => void }) {
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc]           = useState('');
  const [holder, setHolder]       = useState('');
  const [bankName, setBankName]   = useState('');
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const accountValid = /^\d{9,18}$/.test(accountNo);
  const ifscValid    = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
  const canSubmit    = accountValid && ifscValid && holder.trim() && bankName.trim() && !busy;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const b = await registerCarretBank({
        bank_account_no: accountNo,
        bank_ifsc: ifsc.toUpperCase(),
        bank_account_name: holder.trim(),
        bank_name: bankName.trim(),
      });
      onRegistered(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register bank');
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl bg-white p-6 space-y-4">
      <div>
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">Add your bank</h2>
        <p className="text-sm text-black/60 mt-1">
          INR from your withdrawals lands here. Carret verifies ownership with a ₹1 penny-drop —
          usually clears in under a minute.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-black/50 mb-1">Account number</span>
          <input
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 33611990000004"
            inputMode="numeric"
            className="h-12 rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 text-base w-full focus:outline-none focus:border-black/30"
          />
          {accountNo && !accountValid && <span className="text-xs text-red-600 mt-1 block">9-18 digits</span>}
        </label>
        <label className="text-sm">
          <span className="block text-black/50 mb-1">IFSC</span>
          <input
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value.toUpperCase())}
            placeholder="e.g. HDFC0001234"
            maxLength={11}
            className="h-12 rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 text-base w-full font-mono uppercase focus:outline-none focus:border-black/30"
          />
          {ifsc && !ifscValid && <span className="text-xs text-red-600 mt-1 block">11 chars, e.g. HDFC0001234</span>}
        </label>
        <label className="text-sm md:col-span-2">
          <span className="block text-black/50 mb-1">Account holder name (as printed in passbook)</span>
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="e.g. AADITYA SINGH"
            className="h-12 rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 text-base w-full focus:outline-none focus:border-black/30"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="block text-black/50 mb-1">Bank name</span>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. HDFC Bank"
            className="h-12 rounded-xl border border-black/10 bg-white text-black placeholder:text-black/30 px-3 text-base w-full focus:outline-none focus:border-black/30"
          />
        </label>
      </div>
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="bg-black text-white text-sm font-medium px-6 py-3 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-40"
      >
        {busy ? 'Verifying…' : 'Add bank'}
      </button>
    </div>
  );
}

function BanksList({ banks }: { banks: CarretBank[] }) {
  return (
    <div className="rounded-2xl bg-white p-6 space-y-3">
      <h2 className="text-black text-lg font-medium tracking-[-0.02em]">Your bank{banks.length > 1 ? 's' : ''}</h2>
      <div className="space-y-2">
        {banks.map((b) => (
          <div key={b.id} className="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[0.02] px-4 py-3">
            <div className="grid place-items-center h-9 w-9 rounded-full bg-black/[0.05] shrink-0">🏦</div>
            <div className="flex-1 min-w-0">
              <div className="text-black text-sm font-medium truncate">{b.bank_name}</div>
              <div className="text-xs text-black/50 font-mono">
                {b.bank_ifsc} · ••{b.bank_account_no.slice(-4)}
              </div>
            </div>
            <span className={`text-xs rounded-full border px-2 py-0.5 ${
              b.status === 'verified'
                ? 'bg-[#03C394]/12 text-[#032018] border-[#03C394]/30'
                : b.status === 'failed'
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : 'bg-amber-100 text-amber-700 border-amber-300'
            }`}>
              {b.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
