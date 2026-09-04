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

const batches = new Map<string, PayoutBatch>();

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
  await provider.start(batch, payouts);
  batch.status = 'started';
  batch.updatedAt = new Date().toISOString();
  batches.set(batch.id, batch);
  return batch;
}

async function refresh(batch: PayoutBatch): Promise<PayoutBatch> {
  if (batch.status === 'completed' || batch.status === 'error') return batch;
  const next = await provider.status(batch);
  if (next.status !== batch.status) {
    batch.status = next.status;
    batch.updatedAt = new Date().toISOString();
  }
  batch.receipts = next.receipts;
  return batch;
}

export async function getPayoutBatch(id: string): Promise<PayoutBatch> {
  const b = batches.get(id);
  if (!b) throw httpError(`Payout batch ${id} not found`, 404, 'NotFound');
  return refresh(b);
}

export async function listPayoutBatches(cursor?: string, limit = 50): Promise<PayoutBatchPage> {
  const all = await Promise.all([...batches.values()].map(refresh));
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : null;
  return { items, nextCursor: next };
}
