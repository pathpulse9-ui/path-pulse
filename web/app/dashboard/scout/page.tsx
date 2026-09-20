'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  ScoutConfig,
  ScoutAssignment,
  ScoutTierLookup,
  ScoutRevocation,
  ScoreFeedStatus,
} from '@pathpulse/contract';
import { getScoutConfig, getScoreFeed, assignScoutTier, getScoutTier, revokeScoutTier } from '../../lib/api';
import { ErrorNotice } from '../../components/dashboard/ErrorNotice';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

function tierFor(score: number): 1 | 2 | 3 {
  if (score >= 0.8) return 3;
  if (score >= 0.5) return 2;
  return 1;
}

function feedLabel(feed: ScoreFeedStatus) {
  if (feed.mode === 'pulsegen-live') {
    return `PulseGen endpoint configured · ${feed.endpointHost ?? 'unknown host'}`;
  }
  if (feed.mode === 'pulsegen-batch') return 'PulseGen · delivered batch';
  return 'Interim — awaiting delivery';
}

function feedClasses(mode: ScoreFeedStatus['mode']) {
  if (mode === 'pulsegen-live') return 'bg-green-100 text-green-700 border-green-300';
  if (mode === 'pulsegen-batch') return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-amber-100 text-amber-700 border-amber-300';
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 justify-between">
      <span className="text-black/50 shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono text-xs' : ''} text-right break-all`}>{value}</span>
    </div>
  );
}

function tierClasses(tier: number) {
  if (tier === 3) return 'bg-green-100 text-green-700 border-green-300';
  if (tier === 2) return 'bg-blue-100 text-blue-700 border-blue-300';
  return 'bg-gray-100 text-gray-600 border-gray-300';
}

export default function ScoutPage() {
  const [config, setConfig] = useState<ScoutConfig | null>(null);
  const [feed, setFeed] = useState<ScoreFeedStatus | null>(null);
  const [driverId, setDriverId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignments, setAssignments] = useState<ScoutAssignment[]>([]);
  const [error, setError] = useState<unknown>(null);

  const [lookupAddr, setLookupAddr] = useState('');
  const [lookup, setLookup] = useState<ScoutTierLookup | null>(null);

  const [revokeAddr, setRevokeAddr] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revocation, setRevocation] = useState<ScoutRevocation | null>(null);
  const [revokeError, setRevokeError] = useState<unknown>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getScoutConfig().then(setConfig).catch(() => setError('Failed to reach Backend Core'));
  }, []);

  const loadFeed = useCallback(() => {
    getScoreFeed().then(setFeed).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const revoke = useCallback(async () => {
    setRevoking(true);
    setRevokeError(null);
    setRevocation(null);
    try {
      const r = await revokeScoutTier(revokeAddr.trim());
      setRevocation(r);
      if (lookup?.address === r.address) setLookup({ address: r.address, tier: null, multiplier: 1 });
    } catch (e) {
      setRevokeError(e ?? 'Revoke failed');
    } finally {
      setRevoking(false);
    }
  }, [revokeAddr, lookup]);

  const assign = useCallback(async () => {
    setAssigning(true);
    setError(null);
    try {
      const a = await assignScoutTier(driverId.trim());
      setAssignments((prev) => [a, ...prev]);
      loadFeed();
    } catch (e) {
      setError(e ?? 'Assign failed');
    } finally {
      setAssigning(false);
    }
  }, [driverId, loadFeed]);

  const doLookup = useCallback(async () => {
    if (!lookupAddr.trim()) return;
    setError(null);
    try {
      setLookup(await getScoutTier(lookupAddr.trim()));
    } catch (e) {
      setError(e ?? 'Lookup failed');
    }
  }, [lookupAddr]);

  return (
    <div className="max-w-3xl space-y-6">
      {config && (
        <div className="rounded-2xl bg-white p-6">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em] mb-1">
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
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-black text-lg font-medium tracking-[-0.02em]">Score feed</h2>
          <span className="text-xs text-black/40">
            {feed ? `${feed.scoredDrivers} scored driver${feed.scoredDrivers === 1 ? '' : 's'}` : '—'}
          </span>
        </div>

        {feed && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`text-xs rounded-full border px-2 py-0.5 ${feedClasses(feed.mode)}`}>
                {feedLabel(feed)}
              </span>
              <span className="text-xs text-black/50">
                {feed.mode === 'derived'
                  ? 'No live feed and no delivered batch — deterministic interim, derived from the driver id.'
                  : 'No score can be entered through this console.'}
              </span>
            </div>

            {feed.latestImport && (
              <div className="rounded-xl border border-black/10 p-4 text-sm space-y-1">
                <div className="text-black/50 text-xs mb-2">Latest delivery</div>
                <Row label="Supplier" value={feed.latestImport.supplier} />
                <Row label="Source" value={feed.latestImport.sourceRef ?? '—'} />
                <Row label="Received" value={new Date(feed.latestImport.receivedAt).toLocaleString()} />
                <Row label="Imported by" value={feed.latestImport.importedBy} />
                <Row label="Scores" value={String(feed.latestImport.scoreCount)} />
                <Row label="Payload SHA-256" value={feed.latestImport.payloadSha256} mono />
                <Row label="Import id" value={feed.latestImport.id} mono />
                <p className="text-xs text-black/40 pt-2">
                  Provenance attests to receipt from the supplier, not to the correctness of the scores.
                </p>
              </div>
            )}

            {feed.scores.length > 0 && (
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-black/50 border-b border-black/10">
                    <th className="py-2 font-medium">Driver</th>
                    <th className="py-2 font-medium">Score</th>
                    <th className="py-2 font-medium">Scored at</th>
                    <th className="py-2 font-medium">Source</th>
                    <th className="py-2 font-medium">Tier it maps to</th>
                    <th className="py-2 font-medium">Badge issued by</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.scores.map((s) => (
                    <tr key={`${s.driverId}-${s.scoredAt}`} className="border-b border-black/5">
                      <td className="py-2 font-mono text-xs">{s.driverId}</td>
                      <td className="py-2">{s.score.toFixed(4)}</td>
                      <td className="py-2 text-xs text-black/50">
                        {new Date(s.scoredAt).toLocaleString()}
                      </td>
                      <td className="py-2 text-xs text-black/50">{s.source}</td>
                      <td className="py-2">
                        <span className={`text-xs rounded-full border px-2 py-0.5 ${tierClasses(tierFor(s.score))}`}>
                          SCOUT{tierFor(s.score)}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {(() => {
                          const a = feed.assignments.find((x) => x.driverId === s.driverId);
                          if (!a) return <span className="text-black/35">not assigned</span>;
                          return (
                            <a
                              href={explorerTx(a.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-blue-600"
                            >
                              {short(a.txHash)}
                            </a>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 space-y-4">
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
          Assign a tier (driver → PulseGen score → badge)
        </h2>
        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-sm">
            <span className="block text-black/50 mb-1">Driver ID</span>
            <input
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              placeholder="an existing driver"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm w-64 font-mono focus:outline-none focus:border-black/30"
            />
          </label>
          <span className="text-xs text-black/40 mb-2">
            score is read from the feed · ≥0.8 → SCOUT3 · ≥0.5 → SCOUT2 · else SCOUT1
          </span>
          <button
            onClick={assign}
            disabled={assigning || !driverId.trim()}
            className="bg-black text-white text-sm font-medium px-6 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200 disabled:opacity-50"
          >
            {assigning ? 'Issuing badge…' : 'Assign & issue'}
          </button>
        </div>
        {error != null && <ErrorNotice error={error} />}

        {assignments.length > 0 && (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-black/50 border-b border-black/10">
                <th className="py-2 font-medium">Driver</th>
                <th className="py-2 font-medium">Score</th>
                <th className="py-2 font-medium">Source</th>
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
                  <td className="py-2">{a.score.toFixed(4)}</td>
                  <td className="py-2 text-xs text-black/50">{a.scoreSource}</td>
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
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
          Revoke a driver&apos;s badge
        </h2>
        <p className="text-sm text-black/50">
          The issuer claws the asset back and de-authorises the trustline in one transaction. The
          driver falls back to the 1.0× multiplier immediately. Requires an operator session.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <input
            id="scout-revoke-address"
            value={revokeAddr}
            onChange={(e) => setRevokeAddr(e.target.value)}
            placeholder="G… driver address"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm flex-1 min-w-64 font-mono focus:outline-none focus:border-black/30"
          />
          <button
            onClick={revoke}
            disabled={revoking || !revokeAddr.trim()}
            className="rounded-full border border-red-300 text-red-700 px-5 py-2 text-sm hover:bg-red-50 transition-colors duration-200 disabled:opacity-50"
          >
            {revoking ? 'Revoking…' : 'Revoke badge'}
          </button>
        </div>
        {revokeError != null && <ErrorNotice error={revokeError} />}
        {revocation && (
          <p className="text-sm">
            Revoked <span className="font-mono">{revocation.assetCode}</span> from{' '}
            <a href={explorerAcct(revocation.address)} target="_blank" rel="noreferrer" className="underline">
              {short(revocation.address)}
            </a>{' '}
            — clawed back {revocation.clawedBackAmount}, now multiplier 1.0×{' '}
            <a href={explorerTx(revocation.txHash)} target="_blank" rel="noreferrer" className="underline">
              {short(revocation.txHash)}
            </a>
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 space-y-3">
        <h2 className="text-black text-lg font-medium tracking-[-0.02em]">
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
  );
}
