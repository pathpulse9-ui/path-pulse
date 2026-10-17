import { randomBytes } from 'node:crypto';
import type {
  AssetRef,
  PayoutBatch,
  PayoutBatchPage,
  PayoutBatchStatus,
  PayoutReceipt,
  SettlementDriverPayout,
} from '@pathpulse/contract';
import { env, sdpLive } from '../config/env.js';
import { db } from '../db/client.js';
import {
  createDisbursement,
  uploadDisbursementInstructions,
  startDisbursement,
  getDisbursement,
  getDisbursementReceivers,
  mapDisbursementStatus,
  mapReceivers,
  assertDistributionIsDriverPool,
  assertPayoutRecipient,
} from './sdp.js';
import {
  withRetry,
  recordBatch,
  attachDisbursement,
  getDisbursementId,
} from './payoutAttempts.js';
import { probeSdp } from './health.js';
import { fromStroops, toStroops } from '../stellar/settlement.js';
import { decodeKeyset, encodeKeyset } from '../db/keyset.js';
import { logUpstream } from '../util/upstreamLog.js';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

interface PayoutProvider {
  readonly sandbox: boolean;
  start(batch: PayoutBatch, payouts: SettlementDriverPayout[], disbursementName: string): Promise<void>;
  status(batch: PayoutBatch): Promise<{ status: PayoutBatchStatus; receipts: PayoutReceipt[] }>;
}

function draftReceipts(payouts: SettlementDriverPayout[]): PayoutReceipt[] {
  return payouts.map((p) => ({ userId: p.userId, address: p.address, tier: p.tier, amount: p.amount, status: 'ready' }));
}

const sandboxProvider: PayoutProvider = {
  sandbox: true,
  async start(batch, payouts) {
    batch.receipts = draftReceipts(payouts);
  },
  async status(batch) {
    const elapsed = (Date.now() - new Date(batch.createdAt).getTime()) / 1000;
    if (elapsed < 6) return { status: 'started', receipts: batch.receipts };
    return { status: 'completed', receipts: batch.receipts.map((r) => ({ ...r, status: 'success' })) };
  },
};

function retryOpts() {
  return { attempts: env.sdp.retryAttempts, baseDelayMs: env.sdp.retryBaseDelayMs };
}

const liveProvider: PayoutProvider = {
  sandbox: false,
  async start(batch, payouts, disbursementName) {
    await recordBatch(batch.id, batch.settlementBatchId, batch.asset.code, batch.asset.issuer);

    const existing = await getDisbursementId(batch.id);
    const disbursementId =
      existing ??
      (await withRetry(
        batch.id,
        'createDisbursement',
        async () => {
          const d = await createDisbursement(disbursementName, batch.asset);
          await attachDisbursement(batch.id, d.id);
          return d.id;
        },
        retryOpts(),
      ));

    await withRetry(
      batch.id,
      'uploadInstructions',
      () => uploadDisbursementInstructions(disbursementId, payouts),
      { ...retryOpts(), disbursementId },
    );
    await withRetry(batch.id, 'startDisbursement', () => startDisbursement(disbursementId), {
      ...retryOpts(),
      disbursementId,
    });

    batch.disbursementId = disbursementId;
    batch.receipts = draftReceipts(payouts);
  },
  async status(batch) {
    const disbursementId = batch.disbursementId ?? (await getDisbursementId(batch.id));
    if (!disbursementId) return { status: batch.status, receipts: batch.receipts };
    const [disbursement, rows] = await Promise.all([
      getDisbursement(disbursementId),
      getDisbursementReceivers(disbursementId),
    ]);
    return { status: mapDisbursementStatus(disbursement.status), receipts: mapReceivers(batch.receipts, rows) };
  },
};

const provider: PayoutProvider = sdpLive ? liveProvider : sandboxProvider;

interface PayoutBatchRow {
  id: string;
  sandbox: boolean | null;
  status: PayoutBatchStatus | null;
  asset_code: string;
  asset_issuer: string | null;
  total_amount: string | null;
  receipts: PayoutReceipt[] | null;
  settlement_batch_id: string | null;
  disbursement_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

function rowToBatch(r: PayoutBatchRow): PayoutBatch {
  return {
    id: r.id,
    provider: 'sdp',
    sandbox: !!r.sandbox,
    status: r.status ?? 'draft',
    asset: r.asset_issuer ? { code: r.asset_code, issuer: r.asset_issuer } : { code: r.asset_code },
    totalAmount: r.total_amount ?? '0',
    receipts: r.receipts ?? [],
    settlementBatchId: r.settlement_batch_id ?? undefined,
    disbursementId: r.disbursement_id ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
  };
}

async function insertBatch(batch: PayoutBatch): Promise<boolean> {
  const res = await db().query(
    `insert into payout_batches
       (id, provider, sandbox, status, asset_code, asset_issuer, total_amount, receipts,
        settlement_batch_id, disbursement_id, created_by, created_at, updated_at)
     select $1, 'sdp', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     where $8::text is null or not exists (
       select 1 from payout_batches where settlement_batch_id = $8 and status is distinct from 'error'
     )
     on conflict (id) do nothing`,
    [
      batch.id,
      batch.sandbox,
      batch.status,
      batch.asset.code,
      batch.asset.issuer ?? null,
      batch.totalAmount,
      JSON.stringify(batch.receipts),
      batch.settlementBatchId ?? null,
      batch.disbursementId ?? null,
      batch.createdBy ?? null,
      batch.createdAt,
      batch.updatedAt,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

async function priorBatchCount(settlementBatchId: string): Promise<number> {
  const r = await db().query<{ n: string }>(
    'select count(*)::text as n from payout_batches where settlement_batch_id = $1',
    [settlementBatchId],
  );
  return Number(r.rows[0].n);
}

async function saveBatchState(batch: PayoutBatch): Promise<void> {
  await db().query(
    `update payout_batches
       set status = $2, receipts = $3, disbursement_id = $4, updated_at = $5
     where id = $1`,
    [batch.id, batch.status, JSON.stringify(batch.receipts), batch.disbursementId ?? null, batch.updatedAt],
  );
}

async function assertSdpReachable(): Promise<void> {
  try {
    await probeSdp();
  } catch (e) {
    logUpstream('sdp unreachable', e);
    throw httpError('SDP is unreachable', 503, 'PayoutProviderUnavailable');
  }
}

export async function createPayoutBatch(
  payouts: SettlementDriverPayout[],
  asset: AssetRef,
  opts: { settlementBatchId?: string; createdBy?: string } = {},
): Promise<PayoutBatch> {
  if (!payouts.length) throw httpError('payouts must be a non-empty array', 400, 'ValidationError');
  for (const p of payouts) assertPayoutRecipient(p.userId, p.address);
  if (!provider.sandbox) await assertSdpReachable();
  if (!provider.sandbox && env.network === 'mainnet') await assertDistributionIsDriverPool();
  const totalAmount = fromStroops(payouts.reduce((sum, p) => sum + toStroops(p.amount), 0n));
  const now = new Date().toISOString();
  const batch: PayoutBatch = {
    id: `pob_${Date.now()}_${randomBytes(4).toString('hex')}`,
    provider: 'sdp',
    sandbox: provider.sandbox,
    status: 'draft',
    asset,
    totalAmount,
    receipts: [],
    settlementBatchId: opts.settlementBatchId,
    createdBy: opts.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const attempt = opts.settlementBatchId ? await priorBatchCount(opts.settlementBatchId) : 0;
  const disbursementName = opts.settlementBatchId
    ? `pathpulse-${opts.settlementBatchId}${attempt > 0 ? `-r${attempt}` : ''}`
    : `pathpulse-${batch.id}`;
  if (!(await insertBatch(batch))) {
    throw httpError(
      `Settlement batch ${opts.settlementBatchId} already has a payout batch that has not failed`,
      409,
      'DuplicatePayout',
    );
  }
  try {
    await provider.start(batch, payouts, disbursementName);
  } catch (e) {
    batch.status = 'error';
    batch.updatedAt = new Date().toISOString();
    await saveBatchState(batch);
    throw e;
  }
  batch.status = 'started';
  batch.updatedAt = new Date().toISOString();
  await saveBatchState(batch);
  return batch;
}

async function refresh(batch: PayoutBatch): Promise<PayoutBatch> {
  if (batch.status === 'completed' || batch.status === 'error') return batch;
  let next: { status: PayoutBatchStatus; receipts: PayoutReceipt[] };
  try {
    next = await provider.status(batch);
  } catch {
    return batch;
  }
  const statusChanged = next.status !== batch.status;
  const receiptsChanged = JSON.stringify(next.receipts) !== JSON.stringify(batch.receipts);
  batch.receipts = next.receipts;
  if (statusChanged) batch.status = next.status;
  if (statusChanged || receiptsChanged) {
    batch.updatedAt = new Date().toISOString();
    await saveBatchState(batch);
  }
  return batch;
}

export async function getPayoutBatch(id: string): Promise<PayoutBatch> {
  const r = await db().query<PayoutBatchRow>('select * from payout_batches where id = $1', [id]);
  if (!r.rows[0]) throw httpError(`Payout batch ${id} not found`, 404, 'NotFound');
  return refresh(rowToBatch(r.rows[0]));
}

export async function listPayoutBatches(cursor?: string, limit = 50): Promise<PayoutBatchPage> {
  const size = Number.isInteger(limit) ? Math.min(Math.max(1, limit), 100) : 50;
  const key = decodeKeyset(cursor);
  const rows = await db().query<PayoutBatchRow>(
    `select * from payout_batches
     where provider is not null
       and ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::text))
     order by created_at desc, id desc
     limit $3`,
    [key?.createdAt ?? null, key?.id ?? null, size + 1],
  );
  const page = rows.rows.slice(0, size);
  const items = await Promise.all(page.map((row) => refresh(rowToBatch(row))));
  const last = page[page.length - 1];
  return { items, nextCursor: rows.rows.length > size && last ? encodeKeyset(last.created_at, last.id) : null };
}
