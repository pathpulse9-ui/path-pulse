import { randomBytes } from 'node:crypto';
import { TransactionBuilder, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk';
import {
  SCOUT_MULTIPLIER,
  type ScoutTier,
  type CreateSettlementBatchRequest,
  type SettlementBatch,
  type SettlementDriverPayout,
  type SettlementBatchPage,
  type SettlementDeposit,
  type PayoutReceipt,
  type AssetRef,
} from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon, submitToHorizon } from './network.js';
import { provisionManagedWallet, getManagedSigner, getManagedWallet, RESERVE_SPONSOR_USER } from './managed.js';
import { getOnchainTier, retainedTier } from './scout.js';
import { createPayoutBatch, getPayoutBatch, storedReceipts } from '../services/payouts.js';
import {
  attachPayoutBatch,
  listBatches,
  getBatch,
  findBatchIdByDeposit,
  recordPendingBatch,
  setBatchStatus,
  listUnresolvedBatches,
  type BatchQuery,
} from './settlementStore.js';
import { senderAllowlist, verifyDeposit } from './deposits.js';
import { db } from '../db/client.js';
import { sendAlertInBackground } from '../services/alerts.js';
import { assertMainnetAllowed } from './networkGuard.js';
import { logger } from '../config/logger.js';
import { notifyUserInBackground } from '../services/push.js';
import { resolveScore } from '../services/pulsegen.js';
import { logUpstream } from '../util/upstreamLog.js';

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
  if (!/^\d{1,15}(\.\d{1,7})?$/.test(amount)) {
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

async function allowedDepositSenders(settlementSource: string): Promise<string[] | undefined> {
  if (env.network !== 'mainnet') return undefined;
  const routing = await getManagedWallet(ROUTING_SWAP_SOURCE_USER);
  return senderAllowlist(
    [env.distribution.treasury, ...env.distribution.extraDepositSenders, ...(routing ? [routing.address] : [])],
    settlementSource,
  );
}

function fundsMovedError(message: string, status: number, name: string): Error {
  const e = httpError(message, status, name) as Error & { keepIdempotencyKey: boolean };
  e.keepIdempotencyKey = true;
  return e;
}

export async function assertDriversOwnAddresses(drivers: CreateSettlementBatchRequest['drivers']): Promise<void> {
  if (!env.databaseUrl) return;
  for (const d of drivers) {
    const managed = await getManagedWallet(d.userId).catch(() => null);
    if (managed?.address === d.address) {
      if (!managed.provisioned) await provisionManagedWallet(d.userId);
      continue;
    }
    const external = await db().query('select 1 from wallet_users where address = $1 and user_id = $2', [d.address, d.userId]);
    if ((external.rowCount ?? 0) > 0) continue;
    throw httpError(
      `Driver ${d.userId} does not own ${d.address} — the payout address must be that driver's managed or signed-in wallet`,
      422,
      'DriverAddressMismatch',
    );
  }
}

export async function executeSettlementBatch(
  req: CreateSettlementBatchRequest,
  opts: { createdBy?: string; approvedBy?: string; conversion?: SettlementBatch['conversion']; fundedBy?: SettlementDeposit } = {},
): Promise<SettlementBatch> {
  assertMainnetAllowed('settlement batch submit');
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  if (env.network === 'mainnet' && !req.depositTxHash && !opts.fundedBy) {
    throw httpError(
      'depositTxHash is required on mainnet — every settlement must be traceable to the funding deposit that pays it',
      400,
      'DepositRequired',
    );
  }
  if (env.network === 'mainnet' && req.depositTxHash && !req.depositMemo) {
    throw httpError(
      'depositMemo is required on mainnet — the funding deposit must carry a memo naming this settlement',
      400,
      'DepositMemoRequired',
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
  await assertDriversOwnAddresses(req.drivers);

  const source = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const { asset, ref } = assetOf(req.asset);
  const gross = fromStroops(toStroops(req.grossAmount));
  let deposit: SettlementDeposit | undefined = opts.fundedBy;
  if (req.depositTxHash) {
    const usedBy = await findBatchIdByDeposit(req.depositTxHash);
    if (usedBy) throw httpError(`Deposit ${req.depositTxHash} already funded settlement ${usedBy}`, 409, 'DepositAlreadyUsed');
    deposit = await verifyDeposit(
      req.depositTxHash,
      source.address,
      ref,
      gross,
      await allowedDepositSenders(source.address),
      req.depositMemo,
    );
  }

  const scoreByDriver = new Map(
    await Promise.all(
      req.drivers.map(async (d) => [d.userId, await resolveScore(d.userId).catch(() => undefined)] as const),
    ),
  );
  const resolvedDrivers = await Promise.all(
    req.drivers.map(async (d) => {
      const { tier } = await getOnchainTier(d.address);
      const scored = scoreByDriver.get(d.userId);
      return { ...d, tier: retainedTier(tier ?? 1, scored?.score, scored?.scoredAt) };
    }),
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

  let tx = builder.setTimeout(SETTLEMENT_TX_TIMEOUT_SECONDS).build();
  tx = (await (await getManagedSigner(SETTLEMENT_SOURCE_USER)).sign(tx)) as typeof tx;
  const txHash = tx.hash().toString('hex');

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
    status: 'submitted',
    createdAt: new Date().toISOString(),
    network: env.network,
    grossAmount: gross,
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
    txHash,
    horizonUrl: horizonTxUrl(txHash),
    createdBy: opts.createdBy,
    approvedBy: opts.approvedBy,
    deposit,
    conversion: opts.conversion,
  };

  await recordPendingBatch(batch);

  try {
    await submitToHorizon(tx, 'settlement batch submit');
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras
      ?.result_codes;
    if (codes) {
      await setBatchStatus(batchId, 'failed');
      throw httpError(`Settlement rejected by Horizon: ${JSON.stringify(codes)}`, 422, 'HorizonRejected');
    }
    logUpstream('settlement submit outcome unknown', e);
    throw fundsMovedError(
      `Settlement ${batchId} (tx ${txHash}) was sent but Horizon did not confirm it. It is recorded as submitted ` +
        'and will be reconciled against the ledger; do not resend.',
      502,
      'SettlementPending',
    );
  }

  await setBatchStatus(batchId, 'confirmed');
  batch.status = 'confirmed';
  return fanOut(batch, opts.createdBy);
}

async function fanOut(batch: SettlementBatch, createdBy?: string): Promise<SettlementBatch> {
  try {
    const payoutBatch = await createPayoutBatch(batch.driverPayouts, batch.asset, {
      settlementBatchId: batch.id,
      createdBy,
    });
    batch.payoutBatchId = payoutBatch.id;
    await attachPayoutBatch(batch.id, payoutBatch.id);
    for (const p of batch.driverPayouts) {
      notifyUserInBackground(p.userId, {
        title: 'Reward on its way',
        body: `${p.amount} ${batch.asset.code} from settlement ${batch.id} is being paid to your wallet.`,
        data: { kind: 'settlement_payout', settlementBatchId: batch.id },
      });
    }
  } catch (e) {
    logger.error(
      { err: e, batchId: batch.id, txHash: batch.txHash },
      'settlement settled on-chain but payout batch creation failed — batch persisted, driver fan-out needs reconciliation',
    );
    throw fundsMovedError(
      `Settlement ${batch.id} settled on-chain (tx ${batch.txHash}) but the driver payout batch failed: ` +
        `${(e as Error).name}. The settlement is recorded — retry the fan-out with ` +
        `POST /v1/ops/payouts/batches {"settlementBatchId":"${batch.id}"}.`,
      502,
      'PayoutProviderUnavailable',
    );
  }
  return batch;
}

export const SETTLEMENT_TX_TIMEOUT_SECONDS = 180;

export async function reconcileSubmittedBatches(now = Date.now()): Promise<{ confirmed: string[]; failed: string[] }> {
  const out = { confirmed: [] as string[], failed: [] as string[] };
  for (const batch of await listUnresolvedBatches()) {
    let landed: boolean | null = null;
    try {
      const record = await horizon.transactions().transaction(batch.txHash).call();
      landed = record.successful;
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status !== 404) {
        logUpstream('settlement reconcile lookup failed', e);
        continue;
      }
    }
    const expired = now - Date.parse(batch.createdAt) > (SETTLEMENT_TX_TIMEOUT_SECONDS + 60) * 1000;
    if (landed === true) {
      await setBatchStatus(batch.id, 'confirmed');
      out.confirmed.push(batch.id);
      sendAlertInBackground({
        key: `settlement:reconciled:${batch.id}`,
        severity: 'critical',
        title: 'Settlement confirmed by the reconciler',
        detail: `Batch ${batch.id} (tx ${batch.txHash}) landed after its request failed. Run the driver fan-out with POST /v1/ops/payouts/batches.`,
      });
    } else if (landed === false || expired) {
      await setBatchStatus(batch.id, 'failed');
      out.failed.push(batch.id);
    }
  }
  return out;
}

export async function listSettlementBatches(query: BatchQuery = {}): Promise<SettlementBatchPage> {
  return listBatches({ ...query, network: query.network ?? env.network });
}

export function withPayoutHashes(batch: SettlementBatch, receipts: PayoutReceipt[] | undefined): SettlementBatch {
  if (!receipts?.length) return batch;
  return {
    ...batch,
    driverPayouts: batch.driverPayouts.map((p) => {
      const hash = receipts.find((r) => r.userId === p.userId && r.address === p.address)?.stellarTxHash;
      return hash ? { ...p, payoutTxHash: hash } : p;
    }),
  };
}

export async function getSettlementBatchWithPayouts(id: string): Promise<SettlementBatch> {
  const batch = await getSettlementBatch(id);
  if (!batch.payoutBatchId) return batch;
  const payout = await getPayoutBatch(batch.payoutBatchId).catch(() => null);
  return withPayoutHashes(batch, payout?.receipts);
}

export async function attachStoredPayoutHashes(batches: SettlementBatch[]): Promise<SettlementBatch[]> {
  const receipts = await storedReceipts(batches.map((b) => b.payoutBatchId ?? ''));
  return batches.map((b) => withPayoutHashes(b, b.payoutBatchId ? receipts.get(b.payoutBatchId) : undefined));
}

export async function getSettlementBatch(id: string): Promise<SettlementBatch> {
  const b = await getBatch(id);
  if (!b) throw httpError(`Settlement batch ${id} not found`, 404, 'NotFound');
  return b;
}
