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
import { horizon, submitToHorizon } from './network.js';
import { provisionManagedWallet, getManagedSigner, getManagedWallet, RESERVE_SPONSOR_USER } from './managed.js';
import { getOnchainTier } from './scout.js';
import { createPayoutBatch } from '../services/payouts.js';
import {
  saveBatch,
  attachPayoutBatch,
  listBatches,
  getBatch,
  findBatchIdByDeposit,
  type BatchQuery,
} from './settlementStore.js';
import { verifyDeposit } from './deposits.js';
import { assertMainnetAllowed } from './networkGuard.js';
import { logger } from '../config/logger.js';
import { notifyUserInBackground } from '../services/push.js';
import { resolveScore } from '../services/pulsegen.js';

const STROOPS = 10_000_000n;
const SETTLEMENT_SOURCE_USER = RESERVE_SPONSOR_USER;
const ROUTING_SWAP_SOURCE_USER = RESERVE_SPONSOR_USER;

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

export function computeSplit(grossStr: string, drivers: CreateSettlementBatchRequest['drivers']): ComputedSplit {
  const gross = toStroops(grossStr);
  const authorities = (gross * 50n) / 100n;
  const treasury = (gross * 20n) / 100n;
  const driverRewards = gross - authorities - treasury;

  const sumWeights = drivers.reduce((a, d) => a + tierWeight(d.tier ?? 1), 0n);
  let allocated = 0n;
  const payouts = drivers.map((d) => {
    const amount = sumWeights > 0n ? (driverRewards * tierWeight(d.tier ?? 1)) / sumWeights : 0n;
    allocated += amount;
    return { userId: d.userId, address: d.address, tier: d.tier ?? 1, amount };
  });
  if (payouts.length > 0) payouts[0].amount += driverRewards - allocated;

  return { authorities, treasury, driverRewards, payouts };
}

function assetOf(ref?: AssetRef): { asset: Asset; ref: AssetRef } {
  if (!ref || !ref.issuer) return { asset: Asset.native(), ref: { code: 'XLM' } };
  return { asset: new Asset(ref.code, ref.issuer), ref };
}

async function allowedDepositSenders(): Promise<string[] | undefined> {
  if (env.network !== 'mainnet') return undefined;
  const routing = await getManagedWallet(ROUTING_SWAP_SOURCE_USER);
  return [env.distribution.treasury, ...env.distribution.extraDepositSenders, ...(routing ? [routing.address] : [])];
}

async function claimDeposit(txHash: string, sourceAddress: string, ref: AssetRef, grossAmount: string) {
  const usedBy = await findBatchIdByDeposit(txHash);
  if (usedBy) throw httpError(`Deposit ${txHash} already funded settlement ${usedBy}`, 409, 'DepositAlreadyUsed');
  return verifyDeposit(txHash, sourceAddress, ref, fromStroops(toStroops(grossAmount)), await allowedDepositSenders());
}

export async function executeSettlementBatch(
  req: CreateSettlementBatchRequest,
  opts: { createdBy?: string; conversion?: SettlementBatch['conversion'] } = {},
): Promise<SettlementBatch> {
  assertMainnetAllowed('settlement batch submit');
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  if (env.network === 'mainnet' && !req.depositTxHash) {
    throw httpError(
      'depositTxHash is required on mainnet — every settlement must be traceable to the funding deposit that pays it',
      400,
      'DepositRequired',
    );
  }
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

  const source = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const { asset, ref } = assetOf(req.asset);
  const deposit = req.depositTxHash ? await claimDeposit(req.depositTxHash, source.address, ref, req.grossAmount) : undefined;

  const resolvedDrivers = await Promise.all(
    req.drivers.map(async (d) => {
      const { tier } = await getOnchainTier(d.address);
      return { ...d, tier: tier ?? 1 };
    }),
  );

  const scoreByDriver = new Map(
    await Promise.all(
      req.drivers.map(async (d) => [d.userId, await resolveScore(d.userId).catch(() => undefined)] as const),
    ),
  );
  const split = computeSplit(req.grossAmount, resolvedDrivers);

  const account = await horizon.loadAccount(source.address);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
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
    res = await submitToHorizon(tx, 'settlement batch submit');
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras
      ?.result_codes;
    throw httpError(
      codes ? `Settlement rejected by Horizon: ${JSON.stringify(codes)}` : `Settlement submit failed: ${String(e)}`,
      422,
      'HorizonRejected',
    );
  }

  const driverPayouts: SettlementDriverPayout[] = split.payouts.map((p) => {
    const scored = scoreByDriver.get(p.userId);
    return {
      userId: p.userId,
      address: p.address,
      tier: p.tier,
      multiplier: SCOUT_MULTIPLIER[p.tier],
      amount: fromStroops(p.amount),
      score: scored?.score,
      scoreSource: scored?.source,
      scoredAt: scored?.scoredAt,
      scoreImportId: scored?.importId ?? undefined,
    };
  });

  const batchId = `stl_${Date.now()}_${randomBytes(4).toString('hex')}`;

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
    createdBy: opts.createdBy,
    deposit,
    conversion: opts.conversion,
  };

  await saveBatch(batch);

  try {
    const payoutBatch = await createPayoutBatch(driverPayouts, ref, {
      settlementBatchId: batchId,
      createdBy: opts.createdBy,
    });
    batch.payoutBatchId = payoutBatch.id;
    await attachPayoutBatch(batchId, payoutBatch.id);
    for (const p of driverPayouts) {
      notifyUserInBackground(p.userId, {
        title: 'Reward on its way',
        body: `${p.amount} ${ref.code} from settlement ${batchId} is being paid to your wallet.`,
        data: { kind: 'settlement_payout', settlementBatchId: batchId },
      });
    }
  } catch (e) {
    logger.error(
      { err: e, batchId, txHash: res.hash },
      'settlement settled on-chain but payout batch creation failed — batch persisted, driver fan-out needs reconciliation',
    );
    throw httpError(
      `Settlement ${batchId} settled on-chain (tx ${res.hash}) but the driver payout batch failed: ` +
        `${(e as Error).message}. The settlement is recorded — retry the fan-out with ` +
        `POST /v1/ops/payouts/batches {"settlementBatchId":"${batchId}"}.`,
      502,
      'PayoutProviderUnavailable',
    );
  }

  return batch;
}

export async function listSettlementBatches(query: BatchQuery = {}): Promise<SettlementBatchPage> {
  return listBatches({ ...query, network: query.network ?? env.network });
}

export async function getSettlementBatch(id: string): Promise<SettlementBatch> {
  const b = await getBatch(id);
  if (!b) throw httpError(`Settlement batch ${id} not found`, 404, 'NotFound');
  return b;
}
