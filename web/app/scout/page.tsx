'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScoutConfig, ScoutAssignment, ScoutTierLookup } from '@pathpulse/contract';
import { getScoutConfig, assignScoutTier, getScoutTier } from '../lib/api';
import { ConsoleHeader } from '../components/ConsoleHeader';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

function tierClasses(tier: number) {
  if (tier === 3) return 'bg-green-100 text-green-700 border-green-300';
  if (tier === 2) return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-gray-100 text-gray-600 border-gray-300';
}

export default function ScoutPage() {
  const [config, setConfig] = useState<ScoutConfig | null>(null);
  const [score, setScore] = useState('0.9');
  const [assigning, setAssigning] = useState(false);
  const [assignments, setAssignments] = useState<ScoutAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [lookupAddr, setLookupAddr] = useState('');
  const [lookup, setLookup] = useState<ScoutTierLookup | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getScoutConfig().then(setConfig).catch(() => setError('Failed to reach Backend Core'));
  }, []);

  const assign = useCallback(async () => {
    setAssigning(true);
    setError(null);
    try {
      const a = await assignScoutTier(Number(score));
      setAssignments((prev) => [a, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    } finally {
      setAssigning(false);
    }
  }, [score]);

  const doLookup = useCallback(async () => {
    if (!lookupAddr.trim()) return;
    setError(null);
    try {
      setLookup(await getScoutTier(lookupAddr.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    }
  }, [lookupAddr]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <ConsoleHeader active="scout" />

      <div className="px-6 pb-24">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-black text-3xl md:text-4xl font-medium leading-tight" style={{ letterSpacing: '-0.03em' }}>
              SCOUT Reputation{' '}
              <span className="align-middle text-xs font-medium rounded-full border border-blue-300 bg-blue-100 text-blue-700 px-2 py-0.5">
                TESTNET
              </span>
            </h1>
            <p className="text-sm text-black/60 mt-2">
              On-chain reputation tiers as Classic Assets (AUTH_REQUIRED · REVOCABLE · CLAWBACK).
              Tier is assigned from a PulseGen validation score; the settlement engine reads the
              badge on-chain for the reward multiplier.
            </p>
          </div>

          {config && (
            <div className="rounded-2xl bg-white p-6">
              <h2 className="text-black text-lg font-medium mb-1" style={{ letterSpacing: '-0.02em' }}>
                Issuer &amp; tiers
              </h2>
              <p className="text-sm text-black/60 mb-3">
                Issuer{' '}
                <a href={explorerAcct(config.issuer)} target="_blank" rel="noopener noreferrer" className="underline font-mono text-xs">
                  {short(config.issuer)}
                </a>
              </p>
              <div className="flex gap-3 flex-wrap">
                {config.tiers.map((t) => (
                  <span key={t.tier} className={`text-sm rounded-full border px-3 py-1 ${tierClasses(t.tier)}`}>
                    {t.code} · {t.multiplier.toFixed(1)}×
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white p-6 space-y-4">
            <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
              Assign a tier (PulseGen score → badge)
            </h2>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="text-sm">
                <span className="block text-black/50 mb-1">Validation score (0–1)</span>
                <input
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm w-32 focus:outline-none focus:border-black/30"
                />
              </label>
              <span className="text-xs text-black/40 mb-2">≥0.8 → SCOUT3 · ≥0.5 → SCOUT2 · else SCOUT1</span>
              <button
                onClick={assign}
                disabled={assigning}
                className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
              >
                {assigning ? 'Issuing badge…' : 'Assign & issue'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}

            {assignments.length > 0 && (
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-black/50 border-b border-black/10">
                    <th className="py-2 font-medium">Driver</th>
                    <th className="py-2 font-medium">Score</th>
                    <th className="py-2 font-medium">Tier</th>
                    <th className="py-2 font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.txHash} className="border-b border-black/5">
                      <td className="py-2 font-mono text-xs">
                        <a href={explorerAcct(a.address)} target="_blank" rel="noopener noreferrer" className="underline">
                          {short(a.address)}
                        </a>
                      </td>
                      <td className="py-2">{a.score}</td>
                      <td className="py-2">
                        <span className={`text-xs rounded-full border px-2 py-0.5 ${tierClasses(a.tier)}`}>
                          {a.assetCode} · {a.multiplier.toFixed(1)}×
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs">
                        <a href={explorerTx(a.txHash)} target="_blank" rel="noopener noreferrer" className="underline text-blue-600">
                          {short(a.txHash)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 space-y-3">
            <h2 className="text-black text-lg font-medium" style={{ letterSpacing: '-0.02em' }}>
              Look up a driver&apos;s tier
            </h2>
            <div className="flex flex-wrap gap-3 items-end">
              <input
                value={lookupAddr}
                onChange={(e) => setLookupAddr(e.target.value)}
                placeholder="G… driver address"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm flex-1 min-w-64 font-mono focus:outline-none focus:border-black/30"
              />
              <button
                onClick={doLookup}
                className="rounded-full border border-black/10 px-5 py-2 text-sm hover:bg-black/5 transition-colors duration-200"
              >
                Look up
              </button>
            </div>
            {lookup && (
              <p className="text-sm">
                {lookup.tier ? (
                  <>
                    Tier{' '}
                    <span className={`text-xs rounded-full border px-2 py-0.5 ${tierClasses(lookup.tier)}`}>
                      SCOUT{lookup.tier} · {lookup.multiplier.toFixed(1)}×
                    </span>
                  </>
                ) : (
                  <span className="text-black/50">No SCOUT badge held (multiplier 1.0×).</span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
