'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  DistributionAccount,
  TreasuryConfig,
  RoutingQuote,
  RoutingSwapResult,
} from '@pathpulse/contract';
import { API_BASE_URL, getRoutingQuote, executeRoutingSwap } from '../../lib/api';
import { usePageActions } from '../../components/dashboard/PageActions';
import { T } from '../../components/dashboard/typography';

const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

const ROUTABLE = ['XLM', 'USDC'] as const;
type Routable = (typeof ROUTABLE)[number];

const assetLabel = (a: { code: string }) => a.code;
const trimAmount = (v: string) => v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

const ROLE_LABEL: Record<string, string> = {
  partner_revenue: 'Partner revenue',
  driver_pool: 'Driver pool',
  treasury: 'Treasury',
};

function ConversionPanel() {
  const [from, setFrom] = useState<Routable>('XLM');
  const [to, setTo] = useState<Routable>('USDC');
  const [amount, setAmount] = useState('100');
  const [quote, setQuote] = useState<RoutingQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [result, setResult] = useState<RoutingSwapResult | null>(null);

  const valid = /^\d+(\.\d{1,7})?$/.test(amount) && Number(amount) > 0 && from !== to;

  useEffect(() => {
    if (!valid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await getRoutingQuote(from, to, amount);
        if (!cancelled) {
          setQuote(q);
          setQuoteError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(e instanceof Error ? e.message : 'Quote failed');
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [from, to, amount, valid]);

  const flip = useCallback(() => {
    setFrom(to);
    setTo(from);
    setResult(null);
  }, [from, to]);

  const convert = useCallback(async () => {
    setConverting(true);
    setConvertError(null);
    setResult(null);
    try {
      setResult(await executeRoutingSwap({ from, to, amount }));
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  }, [from, to, amount]);

  return (
    <div className="rounded-2xl bg-white p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
            Liquidity conversion{' '}
            <span className="align-middle text-xs font-medium rounded-full border border-blue-300 bg-blue-100 text-blue-700 px-2 py-0.5">
              AQUARIUS · TESTNET
            </span>
          </h2>
          <p className="text-sm text-black/60 mt-1">
            Convert operating balances between XLM and USDC through Aquarius AMM pools before a
            payout run. Routed and settled by Backend Core.
          </p>
        </div>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <label className="flex flex-col gap-2">
          <span className="text-xs text-black/50">Amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-40 rounded-full border border-black/10 px-4 h-10 text-sm outline-none focus:border-black/30 transition-colors duration-200"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-xs text-black/50">From</span>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value as Routable)}
            className="rounded-full border border-black/10 px-4 h-10 text-sm bg-white outline-none focus:border-black/30 transition-colors duration-200"
          >
            {ROUTABLE.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={flip}
          className="rounded-full border border-black/10 px-4 h-10 text-sm hover:bg-black/5 transition-colors duration-200"
        >
          ⇄
        </button>
        <label className="flex flex-col gap-2">
          <span className="text-xs text-black/50">To</span>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value as Routable)}
            className="rounded-full border border-black/10 px-4 h-10 text-sm bg-white outline-none focus:border-black/30 transition-colors duration-200"
          >
            {ROUTABLE.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      {from === to && <p className="text-sm text-red-600">Pick two different assets.</p>}
      {quoteError && <p className="text-sm text-red-600">{quoteError}</p>}

      {quote && (
        <div className="rounded-xl bg-black/[0.03] p-4 space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div className="text-black">
              <span className="text-xl font-medium">{trimAmount(quote.sourceAmount)}</span>{' '}
              <span className="text-black/50 text-sm">{assetLabel(quote.from)}</span>
              <span className="text-black/30 mx-2">→</span>
              <span className="text-xl font-medium">{trimAmount(quote.destinationAmount)}</span>{' '}
              <span className="text-black/50 text-sm">{assetLabel(quote.to)}</span>
            </div>
            <span className="text-xs text-black/50">
              {quoting ? 'refreshing…' : `${quote.hops} hop${quote.hops === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-black/50">Minimum received</div>
              <div className="text-black mt-1">
                {trimAmount(quote.minDestinationAmount)} {assetLabel(quote.to)}
              </div>
            </div>
            <div>
              <div className="text-xs text-black/50">Slippage tolerance</div>
              <div className="text-black mt-1">{(quote.slippageBps / 100).toFixed(2)}%</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-black/50 mb-1">Route</div>
            <div className="text-xs font-mono text-black/60 break-all">
              {quote.route.map((t) => (t === 'native' ? 'XLM' : t.split(':')[0])).join(' → ')}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={convert}
          disabled={!valid || !quote || converting}
          className="bg-black text-white text-sm font-medium px-6 h-10 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
        >
          {converting ? 'Converting…' : 'Convert'}
        </button>
        {!quote && valid && quoting && <span className="text-sm text-black/50">Quoting…</span>}
      </div>

      {convertError && <p className="text-sm text-red-600">{convertError}</p>}

      {result && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm space-y-1">
          <div>
            Converted {trimAmount(result.sourceAmount)} {assetLabel(result.from)} →{' '}
            {trimAmount(result.estimatedDestinationAmount)} {assetLabel(result.to)} ·{' '}
            {result.hops} hop{result.hops === 1 ? '' : 's'}
          </div>
          <div className="text-black/60">
            Source <span className="font-mono text-xs">{result.sourceAddress}</span>
          </div>
          <a
            href={result.horizonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-black transition-colors duration-200"
          >
            view on stellar.expert
          </a>
        </div>
      )}
    </div>
  );
}

export default function TreasuryPage() {
  const [accounts, setAccounts] = useState<DistributionAccount[]>([]);
  const [config, setConfig] = useState<TreasuryConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, c] = await Promise.all([
        fetch(`${API_BASE_URL}/v1/accounts/distribution`, { credentials: 'include' }).then((r) =>
          r.json(),
        ),
        fetch(`${API_BASE_URL}/v1/treasury/config`, { credentials: 'include' }).then((r) =>
          r.json(),
        ),
      ]);
      setAccounts(Array.isArray(a) ? a : []);
      setConfig(c);
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

  usePageActions(
    () => (
      <button onClick={load} disabled={loading} className={T.buttonSecondary}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    ),
    [load, loading],
  );

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {accounts.map((a) => (
          <div key={a.role} className="rounded-2xl bg-white p-6">
            <div className="text-sm text-black/50">{ROLE_LABEL[a.role] ?? a.role}</div>
            <a
              href={explorerAcct(a.publicKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-mono text-xs text-black/70 mt-2 break-all underline hover:text-black transition-colors duration-200"
            >
              {a.publicKey}
            </a>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs rounded-full bg-black/5 text-black/60 px-2 py-0.5">
                {a.network}
              </span>
              {a.multisig && (
                <span className="text-xs rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                  multisig
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConversionPanel />

      {config && (
        <div className="rounded-2xl bg-white p-6">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em] mb-1">
            Multisig configuration
          </h2>
          <p className="text-sm text-black/50 mb-5 font-mono break-all">{config.publicKey}</p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            {(['low', 'medium', 'high'] as const).map((k) => (
              <div key={k} className="rounded-xl bg-black/[0.03] p-4">
                <div className="text-xs text-black/50 capitalize">{k} threshold</div>
                <div className="text-xl font-medium text-black mt-1">{config.thresholds[k]}</div>
              </div>
            ))}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
                <th className="py-2 font-medium">Signer</th>
                <th className="py-2 font-medium text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {config.signers.map((s) => (
                <tr key={s.publicKey} className="border-b border-black/5">
                  <td className="py-2 font-mono text-xs break-all">{s.publicKey}</td>
                  <td className="py-2 text-right">{s.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
