'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DistributionAccount, TreasuryConfig } from '@pathpulse/contract';
import { API_BASE_URL } from '../../lib/api';

const explorerAcct = (a: string) => `https://stellar.expert/explorer/testnet/account/${a}`;

const ROLE_LABEL: Record<string, string> = {
  partner_revenue: 'Partner revenue',
  driver_pool: 'Driver pool',
  treasury: 'Treasury',
};

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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h1 className="text-black text-3xl font-medium" style={{ letterSpacing: '-0.03em' }}>
          Treasury
        </h1>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-full border border-black/10 bg-white px-5 h-10 text-sm hover:bg-black/5 transition-colors duration-200 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {config && (
        <div className="rounded-2xl bg-white p-6">
          <h2 className="text-black font-medium mb-1" style={{ letterSpacing: '-0.02em' }}>
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
