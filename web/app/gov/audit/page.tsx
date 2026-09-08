'use client';

import { useEffect, useState } from 'react';
import type { DistributionAccount, TreasuryConfig } from '@pathpulse/contract';
import { listDistributionAccounts, getTreasuryConfig } from '../../lib/api';

/**
 * Audit trail — pulls the last ~25 operations from Horizon for each named
 * distribution account. All fetches go straight to Horizon (public API,
 * client-side is fine) so this page keeps working even if our backend is
 * temporarily unreachable.
 */
export default function GovAuditPage() {
  const [accounts, setAccounts] = useState<DistributionAccount[]>([]);
  const [treasury, setTreasury] = useState<TreasuryConfig | null>(null);
  const [ops, setOps] = useState<Record<string, HorizonOp[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, t] = await Promise.all([listDistributionAccounts(), getTreasuryConfig()]);
        setAccounts(a);
        setTreasury(t);
        const network = a[0]?.network ?? t.network;
        const horizon =
          network === 'mainnet'
            ? 'https://horizon.stellar.org'
            : 'https://horizon-testnet.stellar.org';
        // Parallel fetch per account.
        const entries = await Promise.all(
          a.map(async (acct) => {
            const res = await fetch(
              `${horizon}/accounts/${acct.publicKey}/operations?order=desc&limit=25`,
            );
            const j = (await res.json()) as { _embedded?: { records?: HorizonOp[] } };
            return [acct.publicKey, j?._embedded?.records ?? []] as const;
          }),
        );
        setOps(Object.fromEntries(entries));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-2 text-sm text-black/60">
          Last 25 on-chain operations per distribution account, straight from Horizon.
        </p>
      </div>

      {error && <div className="rounded-3xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {treasury && (
        <section className="rounded-3xl bg-white p-6">
          <div className="text-sm font-semibold">Treasury multisig</div>
          <div className="mt-1 text-xs text-black/50">
            Master weight 0 disables direct signing — {treasury.thresholds.high} of{' '}
            {treasury.signers.filter((s) => s.weight > 0).length} required.
          </div>
          <ul className="mt-5 divide-y divide-black/5">
            {treasury.signers.map((s) => (
              <li key={s.publicKey} className="flex items-center gap-3 py-2">
                <span className="font-mono text-xs text-black/70">{s.publicKey}</span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    s.weight === 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-[#03C394]/25 text-[#032018]'
                  }`}
                >
                  weight {s.weight}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {accounts.map((a) => (
        <section key={a.role} className="overflow-hidden rounded-3xl bg-white">
          <div className="border-b border-black/5 p-6">
            <div className="text-sm font-semibold">{roleLabel(a.role)}</div>
            <div className="mt-1 font-mono text-[11px] text-black/60">{a.publicKey}</div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-black/[.03] text-left text-[11px] uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-5 py-3">Op</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Details</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {(ops[a.publicKey] ?? []).slice(0, 10).map((op) => (
                <tr key={op.id}>
                  <td className="px-5 py-3">
                    <a
                      href={`https://stellar.expert/explorer/${a.network === 'mainnet' ? 'public' : 'testnet'}/tx/${op.transaction_hash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[11px] text-blue-700 hover:underline"
                    >
                      {op.transaction_hash.slice(0, 8)}…
                    </a>
                  </td>
                  <td className="px-5 py-3 text-xs">{op.type}</td>
                  <td className="px-5 py-3 text-xs text-black/60">{summarize(op)}</td>
                  <td className="px-5 py-3 text-xs text-black/40">{op.created_at.slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
              {(ops[a.publicKey]?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-black/40">
                    No operations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// Minimal shape of a Horizon operation record — enough for the columns above.
interface HorizonOp {
  id: string;
  transaction_hash: string;
  type: string;
  created_at: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  to?: string;
  from?: string;
  starting_balance?: string;
  funder?: string;
  account?: string;
}

function summarize(op: HorizonOp): string {
  switch (op.type) {
    case 'payment':
      return `${op.amount} ${op.asset_type === 'native' ? 'XLM' : op.asset_code ?? '?'} → ${op.to?.slice(0, 6)}…`;
    case 'create_account':
      return `${op.starting_balance} XLM from ${op.funder?.slice(0, 6)}…`;
    case 'set_options':
      return 'signer / thresholds updated';
    case 'change_trust':
      return `trustline ${op.asset_code ?? '?'}`;
    default:
      return op.type;
  }
}

function roleLabel(role: DistributionAccount['role']): string {
  switch (role) {
    case 'partner_revenue': return 'Authorities (50%)';
    case 'driver_pool':     return 'Driver pool (30%)';
    case 'treasury':        return 'Treasury (20%)';
    default:                return role;
  }
}
