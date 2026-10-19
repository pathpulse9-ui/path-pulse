import type { SettlementBatch, SettlementBatchPage, SettlementBatchStatus } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { decodeKeyset, encodeKeyset } from '../db/keyset.js';
import { trimTail } from '../util/bounded.js';
import { databaseOrMemory } from '../util/memoryFallback.js';
import { toStroops } from './settlement.js';

export interface BatchQuery {
  cursor?: string;
  limit?: number;
  network?: string;
  assetCode?: string;
  since?: string;
  until?: string;
  minAmount?: string;
  maxAmount?: string;
}

const inMemory: SettlementBatch[] = [];

function hasDb(): boolean {
  return databaseOrMemory('settlement store');
}

const memClaims = new Map<string, string>();

function depositInUse(txHash: string, batchId: string): Error {
  const e = new Error(`Deposit ${txHash} already funded settlement ${batchId}`) as Error & { status: number };
  e.name = 'DepositAlreadyUsed';
  e.status = 409;
  return e;
}

const INSERT_BATCH = `insert into settlement_batches
   (id, created_at, network, gross_amount, asset_code, asset_issuer,
    authorities_amount, driver_rewards_amount, treasury_amount,
    source_address, authorities_address, driver_pool_address, treasury_address,
    tx_hash, horizon_url, payout_batch_id, driver_payouts, created_by,
    deposit_tx_hash, deposit_from, deposit_amount, deposit_at, conversion, status, approved_by)
 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
 on conflict (id) do nothing`;

function batchParams(batch: SettlementBatch): unknown[] {
  return [
    batch.id,
    batch.createdAt,
    batch.network,
    batch.grossAmount,
    batch.asset.code,
    batch.asset.issuer ?? null,
    batch.split.authorities,
    batch.split.driverRewards,
    batch.split.treasury,
    batch.sourceAddress ?? null,
    batch.authoritiesAddress ?? null,
    batch.driverPoolAddress ?? null,
    batch.treasuryAddress ?? null,
    batch.txHash,
    batch.horizonUrl ?? null,
    batch.payoutBatchId ?? null,
    JSON.stringify(batch.driverPayouts ?? []),
    batch.createdBy ?? null,
    batch.deposit?.txHash ?? null,
    batch.deposit?.from ?? null,
    batch.deposit?.amount ?? null,
    batch.deposit?.receivedAt ?? null,
    batch.conversion ? JSON.stringify(batch.conversion) : null,
    batch.status ?? 'confirmed',
    batch.approvedBy ?? null,
  ];
}

export async function saveBatch(batch: SettlementBatch): Promise<void> {
  if (!hasDb()) {
    inMemory.unshift(batch);
    trimTail(inMemory, 1_000);
    return;
  }
  await db().query(INSERT_BATCH, batchParams(batch));
}

export async function recordPendingBatch(batch: SettlementBatch): Promise<void> {
  const deposit = batch.deposit?.txHash;
  if (!hasDb()) {
    if (deposit) {
      const holder = memClaims.get(deposit) ?? inMemory.find((b) => b.deposit?.txHash === deposit && b.status !== 'failed')?.id;
      if (holder) throw depositInUse(deposit, holder);
      memClaims.set(deposit, batch.id);
    }
    inMemory.unshift({ ...batch, status: 'submitted' });
    trimTail(inMemory, 1_000);
    return;
  }
  const client = await db().connect();
  try {
    await client.query('begin');
    if (deposit) {
      const claimed = await client.query(
        `insert into settlement_deposit_claims (deposit_tx_hash, batch_id) values ($1, $2)
         on conflict (deposit_tx_hash) do nothing returning batch_id`,
        [deposit, batch.id],
      );
      if (claimed.rowCount === 0) {
        const holder = await client.query<{ batch_id: string }>(
          'select batch_id from settlement_deposit_claims where deposit_tx_hash = $1',
          [deposit],
        );
        throw depositInUse(deposit, holder.rows[0]?.batch_id ?? 'unknown');
      }
    }
    await client.query(INSERT_BATCH, batchParams({ ...batch, status: 'submitted' }));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function setBatchStatus(id: string, status: SettlementBatchStatus): Promise<void> {
  if (!hasDb()) {
    const row = inMemory.find((b) => b.id === id);
    if (!row) return;
    row.status = status;
    if (status === 'failed' && row.deposit?.txHash && memClaims.get(row.deposit.txHash) === id) {
      memClaims.delete(row.deposit.txHash);
    }
    return;
  }
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query('update settlement_batches set status = $2 where id = $1', [id, status]);
    if (status === 'failed') {
      await client.query('delete from settlement_deposit_claims where batch_id = $1', [id]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function listUnresolvedBatches(): Promise<SettlementBatch[]> {
  if (!hasDb()) return inMemory.filter((b) => b.status === 'submitted');
  const res = await db().query<Row>(
    "select * from settlement_batches where status = 'submitted' order by created_at asc limit 100",
  );
  return res.rows.map(rowToBatch);
}

export async function attachPayoutBatch(batchId: string, payoutBatchId: string): Promise<void> {
  if (!hasDb()) {
    const row = inMemory.find((b) => b.id === batchId);
    if (row) row.payoutBatchId = payoutBatchId;
    return;
  }
  await db().query('update settlement_batches set payout_batch_id = $2 where id = $1', [
    batchId,
    payoutBatchId,
  ]);
}

export async function listBatches(query: BatchQuery = {}): Promise<SettlementBatchPage> {
  const size = Number.isInteger(query.limit) ? Math.min(Math.max(1, query.limit as number), 100) : 50;

  if (!hasDb()) {
    const key = decodeKeyset(query.cursor);
    if (query.cursor && !key) throw invalidCursor();
    const ordered = filterInMemory(inMemory, query).sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    const after = key
      ? ordered.filter((b) => b.createdAt < key.createdAt || (b.createdAt === key.createdAt && b.id < key.id))
      : ordered;
    const items = after.slice(0, size);
    const last = items[items.length - 1];
    return { items, nextCursor: after.length > size && last ? encodeKeyset(last.createdAt, last.id) : null };
  }

  const where: string[] = ["status <> 'failed'"];
  const params: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (query.network)   push('network = ?',    query.network);
  if (query.assetCode) push('asset_code = ?', query.assetCode);
  if (query.since)     push('created_at >= ?', query.since);
  if (query.until)     push('created_at <  ?', query.until);
  if (query.minAmount) push('gross_amount::numeric >= ?::numeric', query.minAmount);
  if (query.maxAmount) push('gross_amount::numeric <= ?::numeric', query.maxAmount);

  const cur = decodeCursor(query.cursor);
  if (query.cursor && !cur) throw invalidCursor();
  if (cur) {
    push('(created_at, id) < (?, ?)', cur.createdAt);
    params.push(cur.id);
    where[where.length - 1] = where[where.length - 1].replace('?, ?', `$${params.length - 1}, $${params.length}`);
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const sql = `
    select * from settlement_batches
    ${whereSql}
    order by created_at desc, id desc
    limit $${params.length + 1}
  `;
  const res = await db().query(sql, [...params, size + 1]);
  const rows = res.rows.slice(0, size).map(rowToBatch);
  const next =
    res.rows.length > size
      ? encodeCursor(res.rows[size - 1].created_at, res.rows[size - 1].id)
      : null;
  return { items: rows, nextCursor: next };
}

export async function getBatch(id: string): Promise<SettlementBatch | null> {
  if (!hasDb()) {
    return inMemory.find((b) => b.id === id) ?? null;
  }
  const res = await db().query('select * from settlement_batches where id = $1', [id]);
  return res.rows[0] ? rowToBatch(res.rows[0]) : null;
}

export async function findBatchIdByDeposit(txHash: string): Promise<string | null> {
  if (!hasDb()) return memClaims.get(txHash) ?? null;
  const res = await db().query<{ batch_id: string }>(
    'select batch_id from settlement_deposit_claims where deposit_tx_hash = $1',
    [txHash],
  );
  return res.rows[0]?.batch_id ?? null;
}

export function _resetInMemoryForTests(): void {
  inMemory.length = 0;
  memClaims.clear();
}

function invalidCursor(): Error {
  const e = new Error('cursor is not a valid page cursor') as Error & { status: number };
  e.name = 'ValidationError';
  e.status = 400;
  return e;
}

function filterInMemory(rows: SettlementBatch[], q: BatchQuery): SettlementBatch[] {
  return rows.filter((b) => {
    if (b.status === 'failed') return false;
    if (q.network && b.network !== q.network) return false;
    if (q.assetCode && b.asset.code !== q.assetCode) return false;
    if (q.since && b.createdAt < q.since) return false;
    if (q.until && b.createdAt >= q.until) return false;
    if (q.minAmount && toStroops(b.grossAmount) < toStroops(q.minAmount)) return false;
    if (q.maxAmount && toStroops(b.grossAmount) > toStroops(q.maxAmount)) return false;
    return true;
  });
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

type Row = {
  id: string;
  created_at: Date;
  network: string;
  gross_amount: string;
  asset_code: string;
  asset_issuer: string | null;
  authorities_amount: string;
  driver_rewards_amount: string;
  treasury_amount: string;
  source_address: string | null;
  authorities_address: string | null;
  driver_pool_address: string | null;
  treasury_address: string | null;
  tx_hash: string;
  horizon_url: string | null;
  payout_batch_id: string | null;
  driver_payouts: SettlementBatch['driverPayouts'];
  created_by: string | null;
  deposit_tx_hash: string | null;
  deposit_from: string | null;
  deposit_amount: string | null;
  deposit_at: Date | null;
  conversion: SettlementBatch['conversion'] | null;
  status: SettlementBatchStatus | null;
  approved_by: string | null;
};

function rowToBatch(r: Row): SettlementBatch {
  return {
    id: r.id,
    status: r.status ?? 'confirmed',
    approvedBy: r.approved_by ?? undefined,
    createdAt: r.created_at.toISOString(),
    network: r.network as SettlementBatch['network'],
    grossAmount: r.gross_amount,
    asset: r.asset_issuer ? { code: r.asset_code, issuer: r.asset_issuer } : { code: r.asset_code },
    split: {
      authorities: r.authorities_amount,
      driverRewards: r.driver_rewards_amount,
      treasury: r.treasury_amount,
    },
    driverPayouts: r.driver_payouts ?? [],
    sourceAddress: r.source_address ?? '',
    authoritiesAddress: r.authorities_address ?? '',
    driverPoolAddress: r.driver_pool_address ?? '',
    treasuryAddress: r.treasury_address ?? '',
    txHash: r.tx_hash,
    horizonUrl: r.horizon_url ?? '',
    payoutBatchId: r.payout_batch_id ?? '',
    createdBy: r.created_by ?? undefined,
    deposit:
      r.deposit_tx_hash && r.deposit_amount && r.deposit_at
        ? {
            txHash: r.deposit_tx_hash,
            from: r.deposit_from ?? '',
            amount: r.deposit_amount,
            receivedAt: r.deposit_at.toISOString(),
          }
        : undefined,
    conversion: r.conversion ?? undefined,
  };
}
