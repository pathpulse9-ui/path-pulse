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
} from './sdp.js';
import {
  withRetry,
  recordBatch,
  attachDisbursement,
  getDisbursementId,
} from './payoutAttempts.js';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

interface PayoutProvider {
  readonly sandbox: boolean;
  start(batch: PayoutBatch, payouts: SettlementDriverPayout[]): Promise<void>;
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
  async start(batch, payouts) {
    await recordBatch(batch.id, batch.settlementBatchId, batch.asset.code, batch.asset.issuer);

    const existing = await getDisbursementId(batch.id);
    const disbursementId =
      existing ??
      (await withRetry(
        batch.id,
        'createDisbursement',
        async () => {
          const d = await createDisbursement(`pathpulse-${batch.id}`, batch.asset);
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
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
  };
}

async function insertBatch(batch: PayoutBatch): Promise<void> {
  await db().query(
    `insert into payout_batches
       (id, provider, sandbox, status, asset_code, asset_issuer, total_amount, receipts,
        settlement_batch_id, disbursement_id, created_at, updated_at)
     values ($1, 'sdp', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      batch.createdAt,
      batch.updatedAt,
    ],
  );
}

async function saveBatchState(batch: PayoutBatch): Promise<void> {
  await db().query(
    `update payout_batches
       set status = $2, receipts = $3, disbursement_id = $4, updated_at = $5
     where id = $1`,
    [batch.id, batch.status, JSON.stringify(batch.receipts), batch.disbursementId ?? null, batch.updatedAt],
  );
}

export async function createPayoutBatch(
  payouts: SettlementDriverPayout[],
  asset: AssetRef,
  opts: { settlementBatchId?: string } = {},
): Promise<PayoutBatch> {
  if (!payouts.length) throw httpError('payouts must be a non-empty array', 400, 'ValidationError');
  const totalAmount = payouts.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(7);
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
    createdAt: now,
    updatedAt: now,
  };
  await insertBatch(batch);
  await provider.start(batch, payouts);
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
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const [rows, count] = await Promise.all([
    db().query<PayoutBatchRow>(
      'select * from payout_batches where provider is not null order by created_at desc, id desc limit $1 offset $2',
      [size, start],
    ),
    db().query<{ n: string }>('select count(*)::text as n from payout_batches where provider is not null'),
  ]);
  const items = await Promise.all(rows.rows.map((row) => refresh(rowToBatch(row))));
  const total = Number(count.rows[0].n);
  return { items, nextCursor: start + size < total ? String(start + size) : null };
}
