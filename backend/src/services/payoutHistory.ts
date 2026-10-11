import type { SessionPayload } from './session.js';
import { horizon } from '../stellar/network.js';
import { getManagedWallet } from '../stellar/managed.js';
import { env } from '../config/env.js';
import type { RewardBalance, RewardPayout, RewardsResponse } from '@pathpulse/contract';

const PAGE_LIMIT_MAX = 100;

interface HorizonPaymentRecord {
  id: string;
  paging_token: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  to?: string;
  from?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  account?: string;
  funder?: string;
  starting_balance?: string;
}

interface HorizonBalanceLine {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

async function walletAddressFor(session: SessionPayload): Promise<string | null> {
  if (session.address) return session.address;
  return (await getManagedWallet(session.userId))?.address ?? null;
}

function isNotFound(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 404;
}

function txUrl(hash: string): string {
  const net = env.network === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${net}/tx/${hash}`;
}

export function toRewardPayout(address: string, r: HorizonPaymentRecord): RewardPayout | null {
  if (r.type === 'create_account') {
    if (r.account !== address) return null;
    return {
      id: r.id,
      cursor: r.paging_token,
      createdAt: r.created_at,
      amount: r.starting_balance ?? '0',
      asset: { code: 'XLM' },
      from: r.funder ?? '',
      txHash: r.transaction_hash,
      explorerUrl: txUrl(r.transaction_hash),
    };
  }
  if (r.to !== address || r.from === address || r.amount === undefined) return null;
  return {
    id: r.id,
    cursor: r.paging_token,
    createdAt: r.created_at,
    amount: r.amount,
    asset: r.asset_type === 'native' ? { code: 'XLM' } : { code: r.asset_code ?? '', issuer: r.asset_issuer },
    from: r.from ?? '',
    txHash: r.transaction_hash,
    explorerUrl: txUrl(r.transaction_hash),
  };
}

function toBalance(b: HorizonBalanceLine): RewardBalance | null {
  if (b.asset_type === 'liquidity_pool_shares') return null;
  return {
    asset: b.asset_type === 'native' ? { code: 'XLM' } : { code: b.asset_code ?? '', issuer: b.asset_issuer },
    balance: b.balance,
  };
}

export async function getRewards(session: SessionPayload, limit: number, cursor?: string): Promise<RewardsResponse> {
  const address = await walletAddressFor(session);
  if (!address) return { address: null, balances: [], items: [], nextCursor: null };

  const size = Math.min(Math.max(limit, 1), PAGE_LIMIT_MAX);
  try {
    const [account, page] = await Promise.all([
      horizon.loadAccount(address),
      (() => {
        const q = horizon.payments().forAccount(address).order('desc').limit(size);
        return (cursor ? q.cursor(cursor) : q).call();
      })(),
    ]);
    const records = page.records as unknown as HorizonPaymentRecord[];
    const items = records
      .map((r) => toRewardPayout(address, r))
      .filter((p): p is RewardPayout => p !== null);
    const last = records[records.length - 1];
    return {
      address,
      balances: (account.balances as HorizonBalanceLine[])
        .map(toBalance)
        .filter((b): b is RewardBalance => b !== null),
      items,
      nextCursor: records.length === size && last ? last.paging_token : null,
    };
  } catch (e) {
    if (isNotFound(e)) return { address, balances: [], items: [], nextCursor: null };
    throw e;
  }
}
