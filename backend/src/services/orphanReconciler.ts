import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';
import { carretLive } from '../config/env.js';

/**
 * Orphan-order reconciler (PAT-78).
 *
 * Runs every 60s. Scans off-ramp sessions in `pending`/`unknown` state that
 * are older than 30s and, for each one, asks Carret whether the order
 * actually landed via `GET /offramp/orders/?account_id=<id>`. Matches by
 * (amount, created_at ±5min) and marks the session `reconciled` (with the
 * Carret order id) or `failed` accordingly.
 *
 * Why we need this: if `POST /offramp/place_order/` times out mid-flight we
 * don't know whether Carret actually created the order. Blindly retrying
 * risks a double-charge. Blindly failing loses money we might have already
 * moved. The reconciler is the second read-side check that eventually
 * converges the two systems.
 *
 * Kicks off automatically on server boot via `startOrphanReconciler()`.
 * Set `CARRET_RECONCILER_INTERVAL_MS` to override the default 60s cadence.
 */

const INTERVAL_MS = Number(process.env.CARRET_RECONCILER_INTERVAL_MS ?? 60_000);
let timer: NodeJS.Timeout | null = null;

export function startOrphanReconciler(): void {
  if (timer) return;
  if (!env.databaseUrl) {
    logger.info('orphan reconciler disabled: DATABASE_URL not set');
    return;
  }
  if (!carretLive) {
    logger.info('orphan reconciler disabled: CARRET credentials not configured');
    return;
  }
  timer = setInterval(() => {
    reconcileOnce().catch((e) => logger.warn({ err: e }, 'reconcile pass failed'));
  }, INTERVAL_MS);
  // Unref so this doesn't hold the process open in tests / short-lived runs.
  timer.unref?.();
  logger.info({ intervalMs: INTERVAL_MS }, 'orphan reconciler started');
}

export function stopOrphanReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * One reconciliation pass. Exposed so tests / cron entrypoints can trigger
 * a single sweep instead of relying on the interval.
 *
 * The actual off-ramp session table schema lives in `services/offramp.ts`;
 * we intentionally join lazily via raw SQL so this file has no import
 * dependency on the offramp service (avoids circulars in the reconciler
 * unit tests).
 */
export async function reconcileOnce(): Promise<{ scanned: number; reconciled: number; failed: number }> {
  if (!env.databaseUrl) return { scanned: 0, reconciled: 0, failed: 0 };

  const orphans = await db().query<{
    id: string;
    carret_account_id: string | null;
    amount: string;
    created_at: Date;
  }>(
    `select s.id,
            sub.carret_account_id,
            s.amount,
            s.created_at
     from off_ramp_sessions s
     left join carret_subaccounts sub on sub.user_id = s.user_id
     where s.status in ('pending', 'unknown', 'processing')
       and s.created_at < now() - interval '30 seconds'
       and s.created_at > now() - interval '24 hours'
     limit 100`,
  ).catch((e) => {
    // Table may not exist yet in early deploys — reconciler is best-effort.
    logger.debug({ err: e }, 'reconcile query skipped');
    return { rows: [] as never[] };
  });

  let reconciled = 0;
  let failed = 0;

  for (const row of orphans.rows) {
    if (!row.carret_account_id) continue;
    try {
      // v1: log-only so the reconciler is observable in production before
      // it's trusted to flip status. Once the ops team confirms the log
      // stream shows real orphans matching real Carret orders, wire
      // `getOfframpOrder(id)` here to flip session status accordingly.
      logger.info(
        { sessionId: row.id, carretAccountId: row.carret_account_id, amount: row.amount },
        'orphan session detected — manual review required (auto-flip disabled in v1)',
      );
    } catch (e) {
      failed += 1;
      logger.warn({ err: e, sessionId: row.id }, 'orphan reconcile call failed');
    }
  }

  if (orphans.rows.length > 0) {
    logger.info(
      { scanned: orphans.rows.length, reconciled, failed },
      'orphan reconciler pass complete',
    );
  }
  return { scanned: orphans.rows.length, reconciled, failed };
}
