'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  CarretBank,
  CarretResumeResponse,
  OnRampQuote,
  OnRampSession,
} from '../../lib/api';
import {
  createOnrampSession,
  getOnrampSession,
  listCarretBanks,
  listOnrampSessions,
  onrampQuote,
  resumeCarretKyc,
} from '../../lib/api';
import { ErrorNotice } from '../../components/dashboard/ErrorNotice';

/**
 * On-ramp: INR → USDC on the driver's Carret trading wallet.
 * Mirrors the off-ramp flow (quote → confirm → poll) direction-reversed.
 * Withdrawal to Stellar is the off-ramp's job — this page just stops at
 * "USDC credited to your Carret balance". Register a bank on the
 * off-ramp page first; on-ramp reuses the same verified bank.
 */
export default function OnRampPage() {
  const [amount, setAmount] = useState('1000');
  const [quote, setQuote] = useState<OnRampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [sessions, setSessions] = useState<OnRampSession[]>([]);
  const [selected, setSelected] = useState<OnRampSession | null>(null);

  const [resume, setResume] = useState<CarretResumeResponse | null | 'loading'>('loading');
  useEffect(() => {
    resumeCarretKyc().then(setResume).catch(() => setResume(null));
  }, []);
  const kycVerified = resume && resume !== 'loading' && resume.kycStatus === 'verified';
  const kycLoading = resume === 'loading';

  const [banks, setBanks] = useState<CarretBank[] | null>(null);
  useEffect(() => {
    if (!kycVerified) return;
    listCarretBanks().then((r) => setBanks(r.items ?? [])).catch(() => setBanks([]));
  }, [kycVerified]);
  const verifiedBank = (banks ?? []).find((b) => b.status === 'verified') ?? null;

  const load = useCallback(async () => {
    try {
      const page = await listOnrampSessions(50);
      setSessions(page.items);
      setSelected((cur) => (cur ? page.items.find((s) => s.id === cur.id) ?? cur : page.items[0] ?? null));
    } catch (e) {
      setError(e ?? 'Failed to load orders');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Live quote — debounced.
  useEffect(() => {
    let cancelled = false;
    setQuoteError(null);
    if (!amount || Number(amount) <= 0) { setQuote(null); return; }
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await onrampQuote(amount);
        if (!cancelled) setQuote(q);
      } catch (e) {
        if (!cancelled) { setQuoteError(e); setQuote(null); }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [amount]);

  // Poll the selected order until terminal.
  useEffect(() => {
    if (!selected) return;
    const terminal = new Set(['filled', 'partially_filled', 'cancelled', 'partially_cancelled', 'completed', 'error']);
    if (terminal.has(selected.status.toLowerCase())) return;
    const iv = setInterval(async () => {
      try {
        const fresh = await getOnrampSession(selected.id);
        setSelected(fresh);
        setSessions((cur) => cur.map((s) => (s.id === fresh.id ? fresh : s)));
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [selected]);

  async function place() {
    setBusy(true); setError(null);
    try {
      const s = await createOnrampSession(amount);
      setSelected(s);
      await load();
    } catch (e) {
      setError(e ?? 'Failed to place order');
    } finally { setBusy(false); }
  }

  const canPlace = kycVerified && !!verifiedBank && !!quote && !busy && Number(amount) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-[-0.02em] text-black">On-ramp</h1>
        <p className="text-sm text-black/60 mt-1">
          Top up your Carret trading wallet with INR from your registered bank. Once filled, you
          can withdraw to Stellar or off-ramp to any other bank.
        </p>
      </div>

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
              Verify your identity to unlock deposits
            </p>
            <p className="text-sm text-black/60 mt-1">
              A one-time KYC with Carret Infra. Takes ~3 minutes.
            </p>
          </div>
          <Link
            href="/dashboard/kyc"
            className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-black text-white hover:bg-gray-800 transition-colors"
          >
            Start
          </Link>
        </div>
      )}

      {kycVerified && banks?.length === 0 && (
        <div className="rounded-2xl bg-white p-6 flex items-start gap-4">
          <div className="grid place-items-center h-10 w-10 rounded-full bg-black/5 shrink-0">🏦</div>
          <div className="flex-1">
            <p className="text-black font-medium tracking-[-0.02em]">Add a bank first</p>
            <p className="text-sm text-black/60 mt-1">
              Carret needs a verified bank on your account before it can debit INR. Register one
              on the off-ramp page (₹1 penny-drop verification).
            </p>
          </div>
          <Link
            href="/dashboard/offramp"
            className="shrink-0 px-4 py-2 rounded-full text-sm font-medium bg-black text-white hover:bg-gray-800 transition-colors"
          >
            Add bank
          </Link>
        </div>
      )}

      {kycVerified && verifiedBank && (
        <div className={`rounded-2xl bg-white p-6 space-y-5 ${!canPlace && !quoting ? '' : ''}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-black text-lg font-medium tracking-[-0.02em]">Deposit INR</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 text-black/70 text-xs font-medium px-3 py-1">
              from {verifiedBank.bank_name} ••{verifiedBank.bank_account_no.slice(-4)}
            </span>
          </div>

          <label className="text-sm block">
            <span className="block text-black/50 mb-1">Amount (INR)</span>
            <div className="flex items-center rounded-xl border border-black/10 focus-within:border-black/30 px-3">
              <span className="text-black/40 mr-1">₹</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-transparent text-black placeholder:text-black/30 py-2 text-lg flex-1 focus:outline-none"
                inputMode="decimal"
              />
              <span className="text-black/40 text-xs ml-1">INR</span>
            </div>
          </label>

          {quoting && (
            <div className="text-xs text-black/50 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Fetching live rate…
            </div>
          )}
          {quote && (
            <div className="rounded-xl bg-black/[0.02] border border-black/5 p-4 text-sm space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-black/60">You receive</span>
                <span className="text-black text-2xl font-medium tracking-[-0.02em]">
                  {Number(quote.cryptoAmount).toFixed(2)} {quote.asset}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-black/50">Rate</span>
                <span className="text-black/70">₹{Number(quote.rate).toFixed(2)} / {quote.asset}</span>
              </div>
              {quote.fees.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between text-xs">
                  <span className="text-black/50">{f.label}</span>
                  <span className="text-black/70">
                    {f.currency === 'INR' ? '₹' : ''}{f.amount}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 text-[11px] text-black/50">
                <span>{quote.live ? '⚡ Live · valid 10 min' : '~ Indicative rate'}</span>
              </div>
            </div>
          )}
          {quoteError != null && <ErrorNotice error={quoteError} />}

          <button
            onClick={place}
            disabled={!canPlace}
            className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
          >
            {busy ? 'Placing…' : `Deposit ₹${amount}`}
          </button>
          {error != null && <ErrorNotice error={error} />}

          <p className="text-xs text-black/50">
            Carret will debit ₹{amount} from {verifiedBank.bank_name} ••{verifiedBank.bank_account_no.slice(-4)}
            {' '}and credit USDC to your trading wallet. Order status updates live below.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="rounded-2xl bg-white p-6 space-y-3">
          <h2 className="text-black text-base font-medium tracking-[-0.02em]">Recent deposits</h2>
          <ul className="divide-y divide-black/5">
            {sessions.map((s) => (
              <li key={s.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-black">
                    ₹{s.amount}
                    {s.cryptoAmount && (
                      <span className="text-black/40"> → {Number(s.cryptoAmount).toFixed(2)} {s.asset}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-black/40 mt-0.5">
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${statusBadge(s.status)}`}>
                  {s.status.replace(/_/g, ' ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === 'filled' || s === 'completed') return 'bg-green-100 text-green-700 border-green-300';
  if (s.includes('cancel') || s === 'error') return 'bg-red-100 text-red-700 border-red-300';
  if (s === 'partially_filled') return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-amber-100 text-amber-700 border-amber-300';
}
