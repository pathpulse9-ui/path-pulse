import type { SettlementBatch, SettlementBatchPage } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

/**
 * Settlement indexer store — dual-mode.
 *
 * With DATABASE_URL set (production, staging, and local Docker Postgres):
 *   → Reads and writes go to the `settlement_batches` table so batches
 *   survive restarts and the gov dashboard can serve query load.
 *
 * Without DATABASE_URL (fast local dev without Docker up):
 *   → Falls back to an in-memory array. Rows lost on restart, but the
 *   backend still boots and every existing test / dev flow keeps working.
 *
 * The store is called from `executeSettlementBatch` (write) and from the
 * route handlers `/v1/settlement/batches[/:id]` (read).
 */

export interface BatchQuery {
  cursor?: string;
  limit?: number;
  network?: string;
  assetCode?: string;
  since?: string;     // ISO-8601
  until?: string;     // ISO-8601
  minAmount?: string;
  maxAmount?: string;
}

const inMemory: SettlementBatch[] = [];

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
}

export async function saveBatch(batch: SettlementBatch): Promise<void> {
  if (!hasDb()) {
    inMemory.unshift(batch);
    return;
  }
  await db().query(
    `insert into settlement_batches
       (id, created_at, network, gross_amount, asset_code, asset_issuer,
        authorities_amount, driver_rewards_amount, treasury_amount,
        source_address, authorities_address, driver_pool_address, treasury_address,
        tx_hash, horizon_url, payout_batch_id, driver_payouts)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (id) do nothing`,
    [
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
    ],
  );
}

export async function listBatches(query: BatchQuery = {}): Promise<SettlementBatchPage> {
  const size = Math.min(Math.max(1, query.limit ?? 50), 100);

  if (!hasDb()) {
    const start = query.cursor ? Math.max(0, parseInt(query.cursor, 10) || 0) : 0;
    const filtered = filterInMemory(inMemory, query);
    const items = filtered.slice(start, start + size);
    const next = start + size < filtered.length ? String(start + size) : null;
    return { items, nextCursor: next };
  }

  const where: string[] = [];
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

  // Cursor pagination on created_at desc + id tiebreak.
  const cur = decodeCursor(query.cursor);
  if (cur) {
    push('(created_at, id) < (?, ?)', cur.createdAt);
    // second placeholder for the id half of the tuple:
    params.push(cur.id);
    where[where.length - 1] = where[where.length - 1].replace('?, ?', `$${params.length - 1}, $${params.length}`);
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const sql = `
    select * from settlement_batches
    ${whereSql}
    order by created_at desc, id desc
    limit ${size + 1}
  `;
  const res = await db().query(sql, params);
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

/** Only called by test fixtures — never in prod. */
export function _resetInMemoryForTests(): void {
  inMemory.length = 0;
}

// ── helpers ────────────────────────────────────────────────────────────────

function filterInMemory(rows: SettlementBatch[], q: BatchQuery): SettlementBatch[] {
  return rows.filter((b) => {
    if (q.network && b.network !== q.network) return false;
    if (q.assetCode && b.asset.code !== q.assetCode) return false;
    if (q.since && b.createdAt < q.since) return false;
    if (q.until && b.createdAt >= q.until) return false;
    if (q.minAmount && Number(b.grossAmount) < Number(q.minAmount)) return false;
    if (q.maxAmount && Number(b.grossAmount) > Number(q.maxAmount)) return false;
    return true;
  });
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch (e) {
    logger.warn({ err: e, cursor }, 'invalid settlement batch cursor');
    return null;
  }
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
};

function rowToBatch(r: Row): SettlementBatch {
  return {
    id: r.id,
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
  };
}
