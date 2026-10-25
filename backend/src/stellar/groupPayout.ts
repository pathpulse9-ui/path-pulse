import { randomBytes } from 'node:crypto';
import { Asset, StrKey } from '@stellar/stellar-sdk';
import type {
  CreateGroupPayoutRequest,
  GroupPayoutBatch,
  GroupPayoutBatchPage,
  GroupPayoutReceipt,
  AssetRef,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { toStroops, fromStroops } from './settlement.js';
import { createPayoutBatch } from '../services/payouts.js';
import { decodeKeyset, encodeKeyset } from '../db/keyset.js';

const GROUP_PAYOUT_SOURCE_USER = '__group_payout_source__';
const MAX_RECIPIENTS = 100;

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

function assetOf(ref?: AssetRef): { asset: Asset; ref: AssetRef } {
  if (!ref || !ref.issuer) return { asset: Asset.native(), ref: { code: 'XLM' } };
  return { asset: new Asset(ref.code, ref.issuer), ref };
}

interface GroupPayoutRow {
  id: string;
  payout_batch_id: string | null;
  disbursement_id: string | null;
  asset_code: string;
  asset_issuer: string | null;
  total_amount: string;
  source_address: string | null;
  memo: string | null;
  network: string;
  receipts: GroupPayoutReceipt[] | null;
  created_by: string | null;
  created_at: string;
}

function rowToGroupBatch(r: GroupPayoutRow): GroupPayoutBatch {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    network: r.network as GroupPayoutBatch['network'],
    asset: r.asset_issuer ? { code: r.asset_code, issuer: r.asset_issuer } : { code: r.asset_code },
    totalAmount: r.total_amount,
    sourceAddress: r.source_address ?? '',
    memo: r.memo ?? undefined,
    payoutBatchId: r.payout_batch_id ?? undefined,
    disbursementId: r.disbursement_id ?? undefined,
    receipts: r.receipts ?? [],
    createdBy: r.created_by ?? undefined,
  };
}

async function insertGroupBatch(batch: GroupPayoutBatch): Promise<void> {
  await db().query(
    `insert into group_payout_batches
       (id, payout_batch_id, disbursement_id, asset_code, asset_issuer, total_amount,
        source_address, memo, network, receipts, created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      batch.id,
      batch.payoutBatchId ?? null,
      batch.disbursementId ?? null,
      batch.asset.code,
      batch.asset.issuer ?? null,
      batch.totalAmount,
      batch.sourceAddress || null,
      batch.memo ?? null,
      batch.network,
      JSON.stringify(batch.receipts),
      batch.createdBy ?? null,
      batch.createdAt,
    ],
  );
}

export async function executeGroupPayout(
  req: CreateGroupPayoutRequest,
  opts: { createdBy?: string } = {},
): Promise<GroupPayoutBatch> {
  if (!req.recipients?.length) throw httpError('recipients must be a non-empty array', 400, 'ValidationError');
  if (req.recipients.length > MAX_RECIPIENTS) {
    throw httpError(`recipients exceeds max of ${MAX_RECIPIENTS} per batch`, 400, 'ValidationError');
  }
  for (const r of req.recipients) {
    if (!StrKey.isValidEd25519PublicKey(r.address)) {
      throw httpError(`Invalid Stellar address for "${r.name}": ${r.address}`, 400, 'ValidationError');
    }
  }

  const { ref } = assetOf(req.asset);
  const payouts = req.recipients.map((r) => ({
    userId: `grp-${r.address.slice(0, 8).toLowerCase()}`,
    address: r.address,
    tier: 1 as const,
    multiplier: 1,
    amount: r.amount,
  }));

  const payoutBatch = await createPayoutBatch(payouts, ref, { createdBy: opts.createdBy });
  const totalStroops = req.recipients.reduce((sum, r) => sum + toStroops(r.amount), 0n);

  const batch: GroupPayoutBatch = {
    id: `grp_${Date.now()}_${randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    network: env.network,
    asset: ref,
    totalAmount: fromStroops(totalStroops),
    sourceAddress: env.sdp.baseUrl ? 'SDP distribution account' : '',
    memo: req.memo?.trim() || undefined,
    payoutBatchId: payoutBatch.id,
    disbursementId: payoutBatch.disbursementId,
    createdBy: opts.createdBy,
    receipts: req.recipients.map((r) => ({
      name: r.name,
      address: r.address,
      amount: r.amount,
      remark: r.remark?.trim() || undefined,
    })),
  };
  await insertGroupBatch(batch);
  return batch;
}

export async function listGroupPayoutBatches(cursor?: string, limit = 50): Promise<GroupPayoutBatchPage> {
  const size = Number.isInteger(limit) ? Math.min(Math.max(1, limit), 100) : 50;
  const key = decodeKeyset(cursor);
  const rows = await db().query<GroupPayoutRow>(
    `select * from group_payout_batches
     where ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::text))
     order by created_at desc, id desc
     limit $3`,
    [key?.createdAt ?? null, key?.id ?? null, size + 1],
  );
  const page = rows.rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    items: page.map(rowToGroupBatch),
    nextCursor: rows.rows.length > size && last ? encodeKeyset(last.created_at, last.id) : null,
  };
}

export async function getGroupPayoutBatch(id: string): Promise<GroupPayoutBatch> {
  const r = await db().query<GroupPayoutRow>('select * from group_payout_batches where id = $1', [id]);
  if (!r.rows[0]) throw httpError(`Group payout batch ${id} not found`, 404, 'NotFound');
  return rowToGroupBatch(r.rows[0]);
}
