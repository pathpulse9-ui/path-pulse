import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

export type PayoutStep = 'createDisbursement' | 'uploadInstructions' | 'startDisbursement';

export interface AttemptRecord {
  id: number;
  batch_id: string;
  disbursement_id: string | null;
  step: PayoutStep;
  attempt: number;
  outcome: 'success' | 'failure';
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

function isRetryable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function record(
  batchId: string,
  step: PayoutStep,
  attempt: number,
  outcome: 'success' | 'failure',
  durationMs: number,
  error?: unknown,
  disbursementId?: string,
): Promise<void> {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  try {
    await db().query(
      `insert into payout_attempts (batch_id, disbursement_id, step, attempt, outcome, error, duration_ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [batchId, disbursementId ?? null, step, attempt, outcome, message?.slice(0, 2000) ?? null, durationMs],
    );
  } catch (e) {
    logger.error({ err: e, batchId, step, attempt }, 'failed to record payout attempt');
  }
}

/**
 * Runs one SDP step with bounded retries and exponential backoff, writing an attempt row per
 * try. Non-retryable responses (4xx other than 408/429) fail immediately rather than burning
 * the budget on a request the server will never accept.
 */
export async function withRetry<T>(
  batchId: string,
  step: PayoutStep,
  fn: () => Promise<T>,
  opts: RetryOptions & { disbursementId?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const base = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await fn();
      await record(batchId, step, attempt, 'success', Date.now() - startedAt, undefined, opts.disbursementId);
      if (attempt > 1) logger.info({ batchId, step, attempt }, 'payout step succeeded on retry');
      return result;
    } catch (e) {
      lastError = e;
      await record(batchId, step, attempt, 'failure', Date.now() - startedAt, e, opts.disbursementId);
      const retryable = isRetryable(e);
      logger.warn(
        { batchId, step, attempt, attempts, retryable, err: (e as Error)?.message },
        'payout step failed',
      );
      if (!retryable || attempt === attempts) break;
      await delay(base * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export async function listAttempts(batchId: string): Promise<AttemptRecord[]> {
  const r = await db().query<AttemptRecord>(
    'select * from payout_attempts where batch_id = $1 order by id asc',
    [batchId],
  );
  return r.rows;
}

export async function recordBatch(
  batchId: string,
  settlementBatchId: string | undefined,
  assetCode: string,
  assetIssuer: string | undefined,
): Promise<void> {
  await db().query(
    `insert into payout_batches (id, settlement_batch_id, asset_code, asset_issuer)
     values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [batchId, settlementBatchId ?? null, assetCode, assetIssuer ?? null],
  );
}

export async function attachDisbursement(batchId: string, disbursementId: string): Promise<void> {
  await db().query('update payout_batches set disbursement_id = $2 where id = $1', [
    batchId,
    disbursementId,
  ]);
}

export async function getDisbursementId(batchId: string): Promise<string | null> {
  const r = await db().query<{ disbursement_id: string | null }>(
    'select disbursement_id from payout_batches where id = $1',
    [batchId],
  );
  return r.rows[0]?.disbursement_id ?? null;
}
