import type { LedgerEntry } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';
import { sendAlertInBackground } from './alerts.js';

const PAGE_SIZE = 200;
const MAX_PAGES_PER_TICK = 10;
const PAYMENT_TYPES = new Set(['payment', 'path_payment_strict_send', 'path_payment_strict_receive', 'create_account']);

export interface HorizonPaymentRecord {
  id: string;
  paging_token: string;
  type: string;
  transaction_hash: string;
  created_at: string;
  from?: string;
  to?: string;
  funder?: string;
  account?: string;
  amount?: string;
  starting_balance?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction_successful?: boolean;
}

export interface IndexedPayment {
  id: string;
  account: string;
  role: string;
  txHash: string;
  type: string;
  from: string;
  to: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  createdAt: string;
}


export interface WatchedAccount {
  role: string;
  address: string;
}

export function toIndexedPayment(record: HorizonPaymentRecord, watched: WatchedAccount): IndexedPayment | null {
  if (!PAYMENT_TYPES.has(record.type) || record.transaction_successful === false) return null;
  const isCreate = record.type === 'create_account';
  const native = isCreate || record.asset_type === 'native';
  return {
    id: record.id,
    account: watched.address,
    role: watched.role,
    txHash: record.transaction_hash,
    type: record.type,
    from: (isCreate ? record.funder : record.from) ?? '',
    to: (isCreate ? record.account : record.to) ?? '',
    assetCode: native ? 'XLM' : (record.asset_code ?? ''),
    assetIssuer: native ? null : (record.asset_issuer ?? null),
    amount: (isCreate ? record.starting_balance : record.amount) ?? '0',
    createdAt: record.created_at,
  };
}

export const ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const OUTFLOW_ALARM_ROLES = new Set(['reserve', 'settlement_source', 'routing_source']);

function expectedOutflow(p: IndexedPayment): boolean {
  return p.type === 'create_account' && toStroopsSafe(p.amount) === 0n;
}

function toStroopsSafe(amount: string): bigint | null {
  if (!/^\d{1,15}(\.\d{1,7})?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  return BigInt(whole) * 10_000_000n + BigInt((frac + '0000000').slice(0, 7));
}

export function unexplainedOutflows(
  payments: IndexedPayment[],
  watched: string,
  knownTxHashes: Set<string>,
  now = Date.now(),
): IndexedPayment[] {
  return payments.filter(
    (p) =>
      p.from === watched &&
      p.to !== watched &&
      !knownTxHashes.has(p.txHash) &&
      !expectedOutflow(p) &&
      now - Date.parse(p.createdAt) < ALERT_LOOKBACK_MS,
  );
}

export async function watchedAccounts(): Promise<WatchedAccount[]> {
  const { getManagedWallet, RESERVE_SPONSOR_USER } = await import('../stellar/managed.js');
  const accounts: WatchedAccount[] = [
    { role: 'treasury', address: env.distribution.treasury },
    { role: 'partner_revenue', address: env.distribution.partnerRevenue },
    { role: 'driver_pool', address: env.distribution.driverPool },
  ];
  for (const [role, userId] of [
    ['reserve', RESERVE_SPONSOR_USER],
    ['settlement_source', '__settlement_source__'],
    ['routing_source', '__routing_swap_source__'],
  ] as const) {
    const wallet = await getManagedWallet(userId).catch(() => null);
    if (wallet?.provisioned && !accounts.some((a) => a.address === wallet.address)) {
      accounts.push({ role, address: wallet.address });
    }
  }
  return accounts.filter((a) => a.address);
}

async function fetchPage(address: string, cursor: string | null): Promise<HorizonPaymentRecord[]> {
  const url = new URL(`${env.horizonUrl.replace(/\/$/, '')}/accounts/${address}/payments`);
  url.searchParams.set('order', 'asc');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('include_failed', 'false');
  if (cursor) url.searchParams.set('cursor', cursor);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Horizon payments for ${address} → ${res.status}`);
  const body = (await res.json()) as { _embedded?: { records?: HorizonPaymentRecord[] } };
  return body._embedded?.records ?? [];
}

async function savePayments(rows: IndexedPayment[]): Promise<void> {
  for (const p of rows) {
    await db().query(
      `insert into chain_payments
         (id, account, role, tx_hash, type, from_address, to_address, asset_code, asset_issuer, amount, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id, account) do nothing`,
      [p.id, p.account, p.role, p.txHash, p.type, p.from, p.to, p.assetCode, p.assetIssuer, p.amount, p.createdAt],
    );
  }
}

async function knownSettlementTxHashes(hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set();
  const r = await db().query<{ h: string }>(
    `select tx_hash as h from settlement_batches where tx_hash = any($1)
     union select deposit_tx_hash from settlement_batches where deposit_tx_hash = any($1)
     union select conversion->>'transferTxHash' from settlement_batches where conversion->>'transferTxHash' = any($1)`,
    [hashes],
  );
  return new Set(r.rows.map((x) => x.h));
}

export async function indexAccount(watched: WatchedAccount): Promise<number> {
  const cur = await db().query<{ cursor: string }>('select cursor from chain_cursors where account = $1', [
    watched.address,
  ]);
  let cursor = cur.rows[0]?.cursor ?? null;
  let indexed = 0;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const records = await fetchPage(watched.address, cursor);
    if (!records.length) break;
    const rows = records.map((r) => toIndexedPayment(r, watched)).filter((p): p is IndexedPayment => p !== null);
    await savePayments(rows);
    indexed += rows.length;
    if (OUTFLOW_ALARM_ROLES.has(watched.role)) {
      const known = await knownSettlementTxHashes([...new Set(rows.map((r) => r.txHash))]);
      for (const p of unexplainedOutflows(rows, watched.address, known)) {
        sendAlertInBackground({
          key: `indexer:outflow:${p.txHash}`,
          severity: 'critical',
          title: `Unexplained outflow from the ${watched.role.replace('_', ' ')} account`,
          detail: `${p.amount} ${p.assetCode} to ${p.to} in tx ${p.txHash}`,
        });
      }
    }
    cursor = records[records.length - 1].paging_token;
    await db().query(
      `insert into chain_cursors (account, cursor, updated_at) values ($1, $2, now())
       on conflict (account) do update set cursor = excluded.cursor, updated_at = now()`,
      [watched.address, cursor],
    );
    if (records.length < PAGE_SIZE) break;
  }
  return indexed;
}

let lastRun: { at: string; indexed: number; error?: string } | null = null;

export function indexerStatus() {
  return lastRun;
}

export async function runIndexerOnce(): Promise<number> {
  let total = 0;
  for (const watched of await watchedAccounts()) total += await indexAccount(watched);
  return total;
}

export function startChainIndexer(intervalMs = env.indexer.intervalMs): void {
  if (!env.databaseUrl || intervalMs <= 0) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      lastRun = { at: new Date().toISOString(), indexed: await runIndexerOnce() };
    } catch (e) {
      lastRun = { at: new Date().toISOString(), indexed: 0, error: 'indexer tick failed' };
      logger.error({ err: e }, 'chain indexer tick failed');
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, intervalMs).unref?.();
}

type Row = {
  id: string;
  account: string;
  role: string;
  tx_hash: string;
  type: string;
  from_address: string;
  to_address: string;
  asset_code: string;
  asset_issuer: string | null;
  amount: string;
  created_at: Date;
  settlement_batch_id: string | null;
  link: LedgerEntry['link'];
};

export async function listLedger(query: { account?: string; cursor?: string; limit?: number }): Promise<{
  items: LedgerEntry[];
  nextCursor: string | null;
}> {
  const size = Number.isInteger(query.limit) ? Math.min(Math.max(1, query.limit as number), 200) : 50;
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.account) {
    params.push(query.account);
    where.push(`p.account = $${params.length}`);
  }
  if (query.cursor) {
    const [at, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
    if (!at || !id || Number.isNaN(Date.parse(at))) {
      const e = new Error('cursor is not a valid page cursor') as Error & { status: number };
      e.name = 'ValidationError';
      e.status = 400;
      throw e;
    }
    params.push(at, id);
    where.push(`(p.created_at, p.id) < ($${params.length - 1}, $${params.length})`);
  }
  const r = await db().query<Row>(
    `select p.*,
            coalesce(s.id, d.id, c.id) as settlement_batch_id,
            case when s.id is not null then 'settlement'
                 when d.id is not null then 'deposit'
                 when c.id is not null then 'conversion' end as link
       from chain_payments p
       left join settlement_batches s on s.tx_hash = p.tx_hash
       left join settlement_batches d on d.deposit_tx_hash = p.tx_hash
       left join settlement_batches c on c.conversion->>'transferTxHash' = p.tx_hash
       ${where.length ? `where ${where.join(' and ')}` : ''}
      order by p.created_at desc, p.id desc
      limit $${params.length + 1}`,
    [...params, size + 1],
  );
  const items = r.rows.slice(0, size).map((row) => ({
    id: row.id,
    account: row.account,
    role: row.role,
    txHash: row.tx_hash,
    type: row.type,
    from: row.from_address,
    to: row.to_address,
    assetCode: row.asset_code,
    assetIssuer: row.asset_issuer,
    amount: row.amount,
    createdAt: row.created_at.toISOString(),
    direction: (row.from_address === row.account ? 'out' : 'in') as LedgerEntry['direction'],
    settlementBatchId: row.settlement_batch_id,
    link: row.link,
  }));
  const last = r.rows.length > size ? r.rows[size - 1] : null;
  return {
    items,
    nextCursor: last ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64url') : null,
  };
}
