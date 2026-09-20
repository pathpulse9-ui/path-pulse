import type { OffRampSession, OffRampStatus } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Durable off-ramp session + status-event store (D4 / T2 follow-up).
 *
 * Backs the in-memory Map previously in `offramp.ts`. Every mutation goes
 * through this module so:
 *   - a process restart doesn't lose an in-flight session,
 *   - the reconciler has a real table to sweep,
 *   - a missed webhook can be healed on the next reconciler pass and the
 *     recovery is visible in the event log.
 *
 * We keep this module DB-only. Callers that also want the in-memory
 * shape hydrated at boot can call `hydrateAll()`.
 *
 * All functions are no-ops (return empty / null) when DATABASE_URL is
 * not configured — that keeps unit tests and short-lived dev runs
 * working without a Postgres dependency.
 */

export type EventSource = 'placed' | 'webhook' | 'poll' | 'reconciler' | 'client';

export interface SessionExtras {
  ppUserId?: string;
  carretOrderId?: string | number;
  carretQuoteId?: string | number;
  carretDepositMemo?: string | null;
  network?: string;
  txHash?: string;
}

export type PersistedSession = OffRampSession & SessionExtras;

function haveDb(): boolean {
  return !!env.databaseUrl;
}

export async function upsertSession(s: PersistedSession, raw?: unknown): Promise<void> {
  if (!haveDb()) return;
  if (!s.ppUserId) {
    // A session without a user id shouldn't reach persistence — every
    // real path sets it in createWithdrawal. Refuse loudly rather than
    // silently write orphaned rows the reconciler can never claim.
    throw new Error(`offramp session ${s.id} has no ppUserId; refusing to persist`);
  }
  await db().query(
    `insert into off_ramp_sessions (
       id, user_id, provider, sandbox, status,
       amount, asset_code, asset_issuer,
       fiat_currency, fiat_amount_estimate,
       settlement_batch_id, interactive_url, anchor_account,
       merchant_transaction_id,
       carret_order_id, carret_quote_id, carret_deposit_memo,
       network, tx_hash, raw,
       created_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
     )
     on conflict (id) do update set
       status                  = excluded.status,
       fiat_amount_estimate    = coalesce(excluded.fiat_amount_estimate, off_ramp_sessions.fiat_amount_estimate),
       interactive_url         = coalesce(excluded.interactive_url, off_ramp_sessions.interactive_url),
       anchor_account          = coalesce(excluded.anchor_account, off_ramp_sessions.anchor_account),
       merchant_transaction_id = coalesce(excluded.merchant_transaction_id, off_ramp_sessions.merchant_transaction_id),
       carret_order_id         = coalesce(excluded.carret_order_id, off_ramp_sessions.carret_order_id),
       carret_quote_id         = coalesce(excluded.carret_quote_id, off_ramp_sessions.carret_quote_id),
       carret_deposit_memo     = coalesce(excluded.carret_deposit_memo, off_ramp_sessions.carret_deposit_memo),
       network                 = coalesce(excluded.network, off_ramp_sessions.network),
       tx_hash                 = coalesce(excluded.tx_hash, off_ramp_sessions.tx_hash),
       raw                     = coalesce(excluded.raw, off_ramp_sessions.raw),
       updated_at              = excluded.updated_at`,
    [
      s.id,
      s.ppUserId,
      s.provider,
      s.sandbox,
      s.status,
      s.amount,
      s.asset.code,
      s.asset.issuer ?? null,
      s.fiatCurrency ?? null,
      s.fiatAmountEstimate ?? null,
      s.settlementBatchId ?? null,
      s.interactiveUrl ?? null,
      s.anchorAccount ?? null,
      s.merchantTransactionId ?? null,
      s.carretOrderId != null ? String(s.carretOrderId) : null,
      s.carretQuoteId != null ? String(s.carretQuoteId) : null,
      s.carretDepositMemo ?? null,
      s.network ?? null,
      s.txHash ?? null,
      raw !== undefined ? JSON.stringify(raw) : null,
      s.createdAt,
      s.updatedAt,
    ],
  );
}

export async function updateStatus(
  id: string,
  status: OffRampStatus,
  extras?: { txHash?: string; network?: string },
): Promise<void> {
  if (!haveDb()) return;
  await db().query(
    `update off_ramp_sessions
       set status = $2,
           tx_hash = coalesce($3, tx_hash),
           network = coalesce($4, network),
           updated_at = now()
     where id = $1`,
    [id, status, extras?.txHash ?? null, extras?.network ?? null],
  );
}

export async function appendEvent(
  sessionId: string,
  source: EventSource,
  carretStatus: string | null,
  mappedStatus: OffRampStatus | null,
  payload?: unknown,
): Promise<void> {
  if (!haveDb()) return;
  await db().query(
    `insert into off_ramp_status_events (session_id, source, carret_status, mapped_status, payload)
     values ($1, $2, $3, $4, $5)`,
    [sessionId, source, carretStatus, mappedStatus, payload !== undefined ? JSON.stringify(payload) : null],
  );
}

export async function getSession(id: string): Promise<PersistedSession | null> {
  if (!haveDb()) return null;
  const { rows } = await db().query(`select * from off_ramp_sessions where id = $1`, [id]);
  return rows[0] ? rowToSession(rows[0]) : null;
}

export async function findByCarretOrder(orderId: string | number): Promise<PersistedSession | null> {
  if (!haveDb()) return null;
  const { rows } = await db().query(
    `select * from off_ramp_sessions where carret_order_id = $1 limit 1`,
    [String(orderId)],
  );
  return rows[0] ? rowToSession(rows[0]) : null;
}

export async function listByUser(userId: string, limit = 100): Promise<PersistedSession[]> {
  if (!haveDb()) return [];
  const { rows } = await db().query(
    `select * from off_ramp_sessions where user_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
  return rows.map(rowToSession);
}

/**
 * Pending / in-flight sessions eligible for reconciler sweep. "in-flight" =
 * everything not in a terminal state; older-than-`minAgeSeconds` avoids
 * racing with a place_order that just wrote its row.
 */
export async function listInFlight(minAgeSeconds = 30, hardLimit = 200): Promise<PersistedSession[]> {
  if (!haveDb()) return [];
  const { rows } = await db().query(
    `select * from off_ramp_sessions
      where status not in ('completed', 'error')
        and updated_at < now() - ($1::text || ' seconds')::interval
        and created_at > now() - interval '48 hours'
      order by created_at desc
      limit $2`,
    [String(minAgeSeconds), hardLimit],
  );
  return rows.map(rowToSession);
}

export async function listEvents(sessionId: string): Promise<Array<{
  id: string;
  source: EventSource;
  carretStatus: string | null;
  mappedStatus: OffRampStatus | null;
  receivedAt: string;
}>> {
  if (!haveDb()) return [];
  const { rows } = await db().query(
    `select id, source, carret_status, mapped_status, received_at
       from off_ramp_status_events
      where session_id = $1
      order by id`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    source: r.source as EventSource,
    carretStatus: r.carret_status,
    mappedStatus: r.mapped_status,
    receivedAt: (r.received_at as Date).toISOString(),
  }));
}

/**
 * Load every non-terminal session at boot so the in-memory Map is
 * primed before the first request lands. The Map remains authoritative
 * for a single process's writes; the DB is the source of truth across
 * restarts.
 */
export async function hydrateAll(): Promise<PersistedSession[]> {
  if (!haveDb()) return [];
  const { rows } = await db().query(
    `select * from off_ramp_sessions
      where created_at > now() - interval '72 hours'
      order by created_at desc
      limit 500`,
  );
  return rows.map(rowToSession);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToSession(r: any): PersistedSession {
  return {
    id: r.id,
    provider: r.provider,
    sandbox: !!r.sandbox,
    status: r.status,
    amount: r.amount,
    asset: { code: r.asset_code, issuer: r.asset_issuer ?? undefined },
    fiatCurrency: r.fiat_currency ?? undefined,
    fiatAmountEstimate: r.fiat_amount_estimate ?? undefined,
    settlementBatchId: r.settlement_batch_id ?? undefined,
    interactiveUrl: r.interactive_url ?? '',
    anchorAccount: r.anchor_account ?? undefined,
    merchantTransactionId: r.merchant_transaction_id ?? undefined,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
    ppUserId: r.user_id,
    carretOrderId: r.carret_order_id ?? undefined,
    carretQuoteId: r.carret_quote_id ?? undefined,
    carretDepositMemo: r.carret_deposit_memo ?? undefined,
    network: r.network ?? undefined,
    txHash: r.tx_hash ?? undefined,
  } as PersistedSession;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _l = logger;
