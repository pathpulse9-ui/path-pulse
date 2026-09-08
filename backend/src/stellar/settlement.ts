import { randomBytes } from 'node:crypto';
import { TransactionBuilder, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk';
import {
  SCOUT_MULTIPLIER,
  type ScoutTier,
  type CreateSettlementBatchRequest,
  type SettlementBatch,
  type SettlementDriverPayout,
  type SettlementBatchPage,
  type AssetRef,
} from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon } from './network.js';
import { provisionManagedWallet, getManagedSigner } from './managed.js';
import { getOnchainTier } from './scout.js';
import { createPayoutBatch } from '../services/payouts.js';
import { saveBatch, listBatches, getBatch, type BatchQuery } from './settlementStore.js';
import { assertMainnetAllowed } from './networkGuard.js';

/**
 * Deterministic 50 / 30 / 20 settlement engine (D6).
 *
 * 50% Authorities · 30% Driver Rewards · 20% Treasury, computed in integer stroops
 * (1 XLM = 10,000,000 stroops) so the parts always sum to the gross exactly — no float
 * drift. The 30% driver pool is split by SCOUT reputation multiplier (1.0 / 1.2 / 1.5).
 *
 *
 * Funds are paid from a dev-tier settlement source account (testnet, backend-controlled).
 * The real PathPulse Treasury multisig is intentionally NOT the signer here — production
 * settlement is signed by the human-gated treasury multisig, never auto-signed.
 */

const STROOPS = 10_000_000n;
const SETTLEMENT_SOURCE_USER = '__settlement_source__';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export function toStroops(amount: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) {
    throw httpError(`Invalid amount "${amount}" (max 7 decimals)`, 400, 'ValidationError');
  }
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * STROOPS + BigInt((frac + '0000000').slice(0, 7));
}

export function fromStroops(v: bigint): string {
  const whole = v / STROOPS;
  const frac = (v % STROOPS).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

function tierWeight(tier: ScoutTier): bigint {
  return BigInt(Math.round(SCOUT_MULTIPLIER[tier] * 1000));
}

export interface ComputedSplit {
  authorities: bigint;
  treasury: bigint;
  driverRewards: bigint;
  payouts: { userId: string; address: string; tier: ScoutTier; amount: bigint }[];
}

/** Pure, deterministic split. Sum(authorities + treasury + all payouts) === gross. */
export function computeSplit(grossStr: string, drivers: CreateSettlementBatchRequest['drivers']): ComputedSplit {
  const gross = toStroops(grossStr);
  const authorities = (gross * 50n) / 100n;
  const treasury = (gross * 20n) / 100n;
  const driverRewards = gross - authorities - treasury; // 30% + any rounding dust

  const sumWeights = drivers.reduce((a, d) => a + tierWeight(d.tier), 0n);
  let allocated = 0n;
  const payouts = drivers.map((d) => {
    const amount = sumWeights > 0n ? (driverRewards * tierWeight(d.tier)) / sumWeights : 0n;
    allocated += amount;
    return { userId: d.userId, address: d.address, tier: d.tier, amount };
  });
  // Assign the rounding remainder to the first driver so the pool sums exactly.
  if (payouts.length > 0) payouts[0].amount += driverRewards - allocated;

  return { authorities, treasury, driverRewards, payouts };
}

// Persistence lives in ./settlementStore — Postgres when DATABASE_URL is set,
// in-memory fallback for local dev. This module writes on execute; reads go
// through the store's list/get helpers so the API can page across restarts.

function assetOf(ref?: AssetRef): { asset: Asset; ref: AssetRef } {
  if (!ref || !ref.issuer) return { asset: Asset.native(), ref: { code: 'XLM' } };
  return { asset: new Asset(ref.code, ref.issuer), ref };
}

export async function executeSettlementBatch(req: CreateSettlementBatchRequest): Promise<SettlementBatch> {
  assertMainnetAllowed('settlement batch submit');
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  const authoritiesAddress = env.distribution.partnerRevenue;
  const driverPoolAddress = env.distribution.driverPool;
  const treasuryAddress = env.distribution.treasury;
  if (!authoritiesAddress || !driverPoolAddress || !treasuryAddress) {
    throw httpError(
      'Distribution accounts not configured (PARTNER_REVENUE_PUBLIC / DRIVER_POOL_PUBLIC / TREASURY_PUBLIC)',
      500,
      'ConfigError',
    );
  }

  // Dev-tier settlement source (testnet, backend-controlled). Provision + fund once.
  const source = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const { asset, ref } = assetOf(req.asset);

  // Reputation is on-chain: resolve each driver's SCOUT tier from their held badge,
  // falling back to the request's tier only when the driver holds no SCOUT asset.
  const resolvedDrivers = await Promise.all(
    req.drivers.map(async (d) => {
      const { tier } = await getOnchainTier(d.address);
      return { ...d, tier: tier ?? d.tier };
    }),
  );
  const split = computeSplit(req.grossAmount, resolvedDrivers);

  const account = await horizon.loadAccount(source.address);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  // Deterministic 50 / 30 / 20 fan-out — three payment ops in one atomic tx, so
  // the split is enforced on-chain (visible in Horizon) rather than only in
  // application code. The driver_pool account then acts as the on-chain
  // incentive-pool custody, from which SDP fans out to individual drivers by
  // tier weight.
  if (split.authorities > 0n)
    builder.addOperation(Operation.payment({ destination: authoritiesAddress, asset, amount: fromStroops(split.authorities) }));
  if (split.driverRewards > 0n)
    builder.addOperation(Operation.payment({ destination: driverPoolAddress, asset, amount: fromStroops(split.driverRewards) }));
  if (split.treasury > 0n)
    builder.addOperation(Operation.payment({ destination: treasuryAddress, asset, amount: fromStroops(split.treasury) }));

  let tx = builder.setTimeout(180).build();
  tx = (await (await getManagedSigner(SETTLEMENT_SOURCE_USER)).sign(tx)) as typeof tx;

  let res;
  try {
    res = await horizon.submitTransaction(tx);
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras
      ?.result_codes;
    throw httpError(
      codes ? `Settlement rejected by Horizon: ${JSON.stringify(codes)}` : `Settlement submit failed: ${String(e)}`,
      422,
      'HorizonRejected',
    );
  }

  const driverPayouts: SettlementDriverPayout[] = split.payouts.map((p) => ({
    userId: p.userId,
    address: p.address,
    tier: p.tier,
    multiplier: SCOUT_MULTIPLIER[p.tier],
    amount: fromStroops(p.amount),
  }));

  const batchId = `stl_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const payoutBatch = await createPayoutBatch(driverPayouts, ref, { settlementBatchId: batchId });

  const batch: SettlementBatch = {
    id: batchId,
    createdAt: new Date().toISOString(),
    network: env.network,
    grossAmount: fromStroops(toStroops(req.grossAmount)),
    asset: ref,
    split: {
      authorities: fromStroops(split.authorities),
      driverRewards: fromStroops(split.driverRewards),
      treasury: fromStroops(split.treasury),
    },
    driverPayouts,
    sourceAddress: source.address,
    authoritiesAddress,
    driverPoolAddress,
    treasuryAddress,
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
    payoutBatchId: payoutBatch.id,
  };
  await saveBatch(batch);
  return batch;
}

export async function listSettlementBatches(query: BatchQuery = {}): Promise<SettlementBatchPage> {
  return listBatches(query);
}

export async function getSettlementBatch(id: string): Promise<SettlementBatch> {
  const b = await getBatch(id);
  if (!b) throw httpError(`Settlement batch ${id} not found`, 404, 'NotFound');
  return b;
}
