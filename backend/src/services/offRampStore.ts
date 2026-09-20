import type { OffRampSession, OffRampStatus } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';

/**
 * Off-ramp session + status-event store — dual-mode, mirroring `settlementStore`.
 *
 * With DATABASE_URL set: rows live in `off_ramp_sessions` and every status
 * transition is appended to `off_ramp_status_events`, so a session survives a
 * restart and its history is auditable against the Carret order and the
 * settlement batch it draws from.
 *
 * Without DATABASE_URL: in-memory maps, so local dev and the test suite keep
 * working without Postgres.
 */

export interface StoredOffRampSession extends OffRampSession {
  ppUserId: string;
  carretOrderId?: string;
  carretQuoteId?: string;
  carretDepositMemo?: string | null;
}

export type OffRampEventSource = 'create' | 'poll' | 'webhook' | 'reconciler';

export interface OffRampStatusEvent {
  sessionId: string;
  previousStatus: OffRampStatus | null;
  status: OffRampStatus;
  source: OffRampEventSource;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface OrphanCandidate {
  sessionId: string;
  userId: string;
  amount: string;
  status: OffRampStatus;
  carretOrderId: string | null;
  carretAccountId: string | null;
  settlementBatchId: string | null;
  createdAt: string;
}

const memSessions = new Map<string, StoredOffRampSession>();
const memEvents: OffRampStatusEvent[] = [];

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
}

export async function saveSession(s: StoredOffRampSession): Promise<void> {
  if (!hasDb()) {
    memSessions.set(s.id, { ...s });
    return;
  }
  await db().query(
    `insert into off_ramp_sessions
       (id, user_id, provider, sandbox, status, amount, asset_code, asset_issuer,
        fiat_currency, fiat_amount_estimate, settlement_batch_id, interactive_url,
        anchor_account, merchant_transaction_id, stellar_tx_hash,
        carret_order_id, carret_quote_id, carret_deposit_memo, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     on conflict (id) do update set
       status = excluded.status,
       fiat_amount_estimate = excluded.fiat_amount_estimate,
       interactive_url = excluded.interactive_url,
       anchor_account = excluded.anchor_account,
       merchant_transaction_id = excluded.merchant_transaction_id,
       stellar_tx_hash = excluded.stellar_tx_hash,
       carret_order_id = excluded.carret_order_id,
       carret_quote_id = excluded.carret_quote_id,
       carret_deposit_memo = excluded.carret_deposit_memo,
       updated_at = excluded.updated_at`,
    [
      s.id,
      s.ppUserId,
      s.provider,
      s.sandbox,
      s.status,
      s.amount,
      s.asset.code,
      s.asset.issuer ?? null,
      s.fiatCurrency,
      s.fiatAmountEstimate ?? null,
      s.settlementBatchId ?? null,
      s.interactiveUrl ?? null,
      s.anchorAccount ?? null,
      s.merchantTransactionId ?? null,
      s.stellarTxHash ?? null,
      s.carretOrderId ?? null,
      s.carretQuoteId ?? null,
      s.carretDepositMemo ?? null,
      s.createdAt,
      s.updatedAt,
    ],
  );
}

export async function getSession(id: string): Promise<StoredOffRampSession | null> {
  if (!hasDb()) {
    const s = memSessions.get(id);
    return s ? { ...s } : null;
  }
  const res = await db().query<Row>('select * from off_ramp_sessions where id = $1', [id]);
  return res.rows[0] ? rowToSession(res.rows[0]) : null;
}

export async function listSessionsByUser(userId: string): Promise<StoredOffRampSession[]> {
  if (!hasDb()) {
    return [...memSessions.values()]
      .filter((s) => s.ppUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ ...s }));
  }
  const res = await db().query<Row>(
    'select * from off_ramp_sessions where user_id = $1 order by created_at desc',
    [userId],
  );
  return res.rows.map(rowToSession);
}

export async function findSessionByCarretOrderId(
  orderId: string,
): Promise<StoredOffRampSession | null> {
  if (!hasDb()) {
    const s = [...memSessions.values()].find((v) => String(v.carretOrderId ?? '') === orderId);
    return s ? { ...s } : null;
  }
  const res = await db().query<Row>(
    'select * from off_ramp_sessions where carret_order_id = $1 order by created_at desc limit 1',
    [orderId],
  );
  return res.rows[0] ? rowToSession(res.rows[0]) : null;
}

export async function recordEvent(e: OffRampStatusEvent): Promise<void> {
  if (!hasDb()) {
    memEvents.push({ ...e });
    return;
  }
  await db().query(
    `insert into off_ramp_status_events (session_id, previous_status, status, source, detail, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      e.sessionId,
      e.previousStatus,
      e.status,
      e.source,
      e.detail ? JSON.stringify(e.detail) : null,
      e.createdAt,
    ],
  );
}

export async function listEvents(sessionId: string): Promise<OffRampStatusEvent[]> {
  if (!hasDb()) {
    return memEvents.filter((e) => e.sessionId === sessionId).map((e) => ({ ...e }));
  }
  const res = await db().query<EventRow>(
    'select * from off_ramp_status_events where session_id = $1 order by id asc',
    [sessionId],
  );
  return res.rows.map((r) => ({
    sessionId: r.session_id,
    previousStatus: r.previous_status as OffRampStatus | null,
    status: r.status as OffRampStatus,
    source: r.source as OffRampEventSource,
    detail: r.detail ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Sessions the reconciler should re-check: still non-terminal, old enough that a
 * webhook should already have arrived, and recent enough that Carret still lists
 * the order. Carries the driver's Carret sub-account so the reconciler can query
 * the right order list, and the settlement batch so recovery keeps the link.
 */
export async function listOrphanCandidates(
  staleSeconds: number,
  limit = 100,
): Promise<OrphanCandidate[]> {
  const cutoff = Date.now() - staleSeconds * 1000;
  const floor = Date.now() - 24 * 60 * 60 * 1000;

  if (!hasDb()) {
    return [...memSessions.values()]
      .filter((s) => s.status !== 'completed' && s.status !== 'error')
      .filter((s) => {
        const t = new Date(s.createdAt).getTime();
        return t < cutoff && t > floor;
      })
      .slice(0, limit)
      .map((s) => ({
        sessionId: s.id,
        userId: s.ppUserId,
        amount: s.amount,
        status: s.status,
        carretOrderId: s.carretOrderId ?? null,
        carretAccountId: null,
        settlementBatchId: s.settlementBatchId ?? null,
        createdAt: s.createdAt,
      }));
  }

  const res = await db().query<OrphanRow>(
    `select s.id,
            s.user_id,
            s.amount,
            s.status,
            s.carret_order_id,
            s.settlement_batch_id,
            s.created_at,
            sub.carret_account_id
     from off_ramp_sessions s
     left join carret_subaccounts sub on sub.user_id = s.user_id
     where s.status not in ('completed', 'error')
       and s.created_at < now() - ($1 || ' seconds')::interval
       and s.created_at > now() - interval '24 hours'
     order by s.created_at asc
     limit ${limit}`,
    [String(staleSeconds)],
  );

  return res.rows.map((r) => ({
    sessionId: r.id,
    userId: r.user_id,
    amount: r.amount,
    status: r.status as OffRampStatus,
    carretOrderId: r.carret_order_id,
    carretAccountId: r.carret_account_id,
    settlementBatchId: r.settlement_batch_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface OpsSessionRow {
  id: string;
  userId: string;
  provider: string;
  status: OffRampStatus;
  amount: string;
  assetCode: string;
  fiatCurrency: string;
  settlementBatchId: string | null;
  carretOrderId: string | null;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every off-ramp session, newest first — the operator view. The per-driver
 * endpoints are scoped to the caller, so without this an operator has no way
 * to inspect a stuck withdrawal that is not their own.
 */
export async function listAllSessions(limit = 100): Promise<OpsSessionRow[]> {
  const size = Math.min(Math.max(1, limit), 500);

  if (!hasDb()) {
    return [...memSessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, size)
      .map((s) => ({
        id: s.id,
        userId: s.ppUserId,
        provider: s.provider,
        status: s.status,
        amount: s.amount,
        assetCode: s.asset.code,
        fiatCurrency: s.fiatCurrency,
        settlementBatchId: s.settlementBatchId ?? null,
        carretOrderId: s.carretOrderId ?? null,
        eventCount: memEvents.filter((e) => e.sessionId === s.id).length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
  }

  const res = await db().query<OpsRow>(
    `select s.id, s.user_id, s.provider, s.status, s.amount, s.asset_code,
            s.fiat_currency, s.settlement_batch_id, s.carret_order_id,
            s.created_at, s.updated_at,
            (select count(*) from off_ramp_status_events e where e.session_id = s.id) as event_count
     from off_ramp_sessions s
     order by s.created_at desc
     limit $1`,
    [size],
  );

  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    status: r.status as OffRampStatus,
    amount: r.amount,
    assetCode: r.asset_code,
    fiatCurrency: r.fiat_currency,
    settlementBatchId: r.settlement_batch_id,
    carretOrderId: r.carret_order_id,
    eventCount: Number(r.event_count),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

/** Only called by test fixtures — never in prod. */
export function _resetInMemoryForTests(): void {
  memSessions.clear();
  memEvents.length = 0;
}

type Row = {
  id: string;
  user_id: string;
  provider: string;
  sandbox: boolean;
  status: string;
  amount: string;
  asset_code: string;
  asset_issuer: string | null;
  fiat_currency: string;
  fiat_amount_estimate: string | null;
  settlement_batch_id: string | null;
  interactive_url: string | null;
  anchor_account: string | null;
  merchant_transaction_id: string | null;
  stellar_tx_hash: string | null;
  carret_order_id: string | null;
  carret_quote_id: string | null;
  carret_deposit_memo: string | null;
  created_at: Date;
  updated_at: Date;
};

type OpsRow = {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  amount: string;
  asset_code: string;
  fiat_currency: string;
  settlement_batch_id: string | null;
  carret_order_id: string | null;
  created_at: Date;
  updated_at: Date;
  event_count: string;
};

type EventRow = {
  session_id: string;
  previous_status: string | null;
  status: string;
  source: string;
  detail: Record<string, unknown> | null;
  created_at: Date;
};

type OrphanRow = {
  id: string;
  user_id: string;
  amount: string;
  status: string;
  carret_order_id: string | null;
  settlement_batch_id: string | null;
  created_at: Date;
  carret_account_id: string | null;
};

function rowToSession(r: Row): StoredOffRampSession {
  return {
    id: r.id,
    ppUserId: r.user_id,
    provider: r.provider as OffRampSession['provider'],
    sandbox: r.sandbox,
    status: r.status as OffRampStatus,
    interactiveUrl: r.interactive_url ?? '',
    amount: r.amount,
    asset: r.asset_issuer ? { code: r.asset_code, issuer: r.asset_issuer } : { code: r.asset_code },
    fiatCurrency: r.fiat_currency,
    fiatAmountEstimate: r.fiat_amount_estimate ?? undefined,
    anchorAccount: r.anchor_account ?? undefined,
    merchantTransactionId: r.merchant_transaction_id ?? undefined,
    settlementBatchId: r.settlement_batch_id ?? undefined,
    stellarTxHash: r.stellar_tx_hash ?? undefined,
    carretOrderId: r.carret_order_id ?? undefined,
    carretQuoteId: r.carret_quote_id ?? undefined,
    carretDepositMemo: r.carret_deposit_memo ?? undefined,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
