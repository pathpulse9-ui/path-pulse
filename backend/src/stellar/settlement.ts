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
import { createPayoutBatch } from '../services/payouts.js';

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

// ── in-memory indexer v1 (feeds D8; persisted to Postgres in a later pass) ──
const batches: SettlementBatch[] = [];

function assetOf(ref?: AssetRef): { asset: Asset; ref: AssetRef } {
  if (!ref || !ref.issuer) return { asset: Asset.native(), ref: { code: 'XLM' } };
  return { asset: new Asset(ref.code, ref.issuer), ref };
}

export async function executeSettlementBatch(req: CreateSettlementBatchRequest): Promise<SettlementBatch> {
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  const authoritiesAddress = env.distribution.partnerRevenue;
  const treasuryAddress = env.distribution.treasury;
  if (!authoritiesAddress || !treasuryAddress) {
    throw httpError('Distribution accounts not configured (PARTNER_REVENUE_PUBLIC / TREASURY_PUBLIC)', 500, 'ConfigError');
  }

  // Dev-tier settlement source (testnet, backend-controlled). Provision + fund once.
  const source = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const { asset, ref } = assetOf(req.asset);
  const split = computeSplit(req.grossAmount, req.drivers);

  const account = await horizon.loadAccount(source.address);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  if (split.authorities > 0n)
    builder.addOperation(Operation.payment({ destination: authoritiesAddress, asset, amount: fromStroops(split.authorities) }));
  if (split.treasury > 0n)
    builder.addOperation(Operation.payment({ destination: treasuryAddress, asset, amount: fromStroops(split.treasury) }));

  let tx = builder.setTimeout(180).build();
  tx = (await getManagedSigner(SETTLEMENT_SOURCE_USER).sign(tx)) as typeof tx;

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
    treasuryAddress,
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
    payoutBatchId: payoutBatch.id,
  };
  batches.unshift(batch); // newest first
  return batch;
}

export function listSettlementBatches(cursor?: string, limit = 50): SettlementBatchPage {
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = batches.slice(start, start + size);
  const next = start + size < batches.length ? String(start + size) : null;
  return { items, nextCursor: next };
}

export function getSettlementBatch(id: string): SettlementBatch {
  const b = batches.find((x) => x.id === id);
  if (!b) throw httpError(`Settlement batch ${id} not found`, 404, 'NotFound');
  return b;
}
