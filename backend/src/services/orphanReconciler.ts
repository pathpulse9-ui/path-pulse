import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { carretLive } from '../config/env.js';
import { getOfframpOrder, mapCarretStatus } from './carret.js';
import { appendEvent, listInFlight, updateStatus } from './offrampStore.js';
import { getMapping } from './carretSubAccountStore.js';

/**
 * Off-ramp reconciler (D4 / T2).
 *
 * Runs every N seconds. Scans persisted off-ramp sessions in a non-terminal
 * state that haven't received an update recently, asks Carret what the
 * current order status is, and — when they disagree — writes an
 * `off_ramp_status_events` row (source: `reconciler`) and updates the
 * session's status to match.
 *
 * Why: if Carret's webhook drops (network blip, our process restarts
 * mid-flight, the signature verification rejects a legit event) the
 * session never leaves its interim status. The reconciler is a
 * self-healing second-source-of-truth that closes the loop on the next
 * pass — the timing gap is bounded by the interval (default 60s) and
 * the healing event is auditable in `off_ramp_status_events`.
 *
 * Set `CARRET_RECONCILER_INTERVAL_MS` to override the cadence. Set
 * `CARRET_RECONCILER_MIN_AGE_S` to change the minimum session age
 * before a sweep touches it (default 30s so a fresh place_order isn't
 * immediately re-checked).
 */

const INTERVAL_MS = Number(process.env.CARRET_RECONCILER_INTERVAL_MS ?? 60_000);
const MIN_AGE_S = Number(process.env.CARRET_RECONCILER_MIN_AGE_S ?? 30);
let timer: NodeJS.Timeout | null = null;

export function startOrphanReconciler(): void {
  if (timer) return;
  if (!env.databaseUrl) {
    logger.info('offramp reconciler disabled: DATABASE_URL not set');
    return;
  }
  if (!carretLive) {
    logger.info('offramp reconciler disabled: CARRET credentials not configured');
    return;
  }
  timer = setInterval(() => {
    reconcileOnce().catch((e) => logger.warn({ err: e }, 'reconcile pass failed'));
  }, INTERVAL_MS);
  // Unref so this doesn't hold the process open in tests / short-lived runs.
  timer.unref?.();
  logger.info({ intervalMs: INTERVAL_MS, minAgeSeconds: MIN_AGE_S }, 'offramp reconciler started');
}

export function stopOrphanReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export interface ReconcileResult {
  scanned: number;
  healed: number;
  unchanged: number;
  failed: number;
  details: Array<{
    sessionId: string;
    carretOrderId: string;
    from: string;
    to: string | null;
    settlementBatchId?: string | null;
    outcome: 'healed' | 'unchanged' | 'failed';
    error?: string;
  }>;
}

export async function reconcileOnce(): Promise<ReconcileResult> {
  const out: ReconcileResult = { scanned: 0, healed: 0, unchanged: 0, failed: 0, details: [] };
  if (!env.databaseUrl) return out;

  const inflight = await listInFlight(MIN_AGE_S, 100);
  out.scanned = inflight.length;
  if (!inflight.length) return out;

  for (const s of inflight) {
    // Sessions without a Carret order id are provider-native (Ramp) or
    // haven't reached place_order yet — nothing to reconcile against Carret.
    if (!s.carretOrderId) continue;

    try {
      if (!carretLive) {
        // No credentials — still record we scanned but couldn't act.
        await appendEvent(s.id, 'reconciler', null, null, { note: 'carret-not-live' });
        out.unchanged += 1;
        out.details.push({
          sessionId: s.id, carretOrderId: String(s.carretOrderId),
          from: s.status, to: null, settlementBatchId: s.settlementBatchId ?? null,
          outcome: 'unchanged',
        });
        continue;
      }

      // Resolve the driver's own Carret account_id — env.carret.accountId
      // is a shared-dev fallback, and Carret's /offramp/orders/?account_id=X
      // only surfaces orders under X, so we MUST pass the account that
      // owns this session's order.
      const mapping = s.ppUserId ? await getMapping(s.ppUserId) : null;
      const orderAccountId = mapping?.carretAccountId;
      const order = await getOfframpOrder(s.carretOrderId, orderAccountId);
      const mapped = mapCarretStatus(order.status);

      if (mapped && mapped !== s.status) {
        await updateStatus(s.id, mapped);
        await appendEvent(s.id, 'reconciler', order.status, mapped, {
          carretOrderId: order.id,
          settlementBatchId: s.settlementBatchId,
          heal: `${s.status} -> ${mapped}`,
        });
        out.healed += 1;
        out.details.push({
          sessionId: s.id, carretOrderId: String(s.carretOrderId),
          from: s.status, to: mapped, settlementBatchId: s.settlementBatchId ?? null,
          outcome: 'healed',
        });
        logger.info(
          {
            sessionId: s.id,
            carretOrderId: order.id,
            from: s.status,
            to: mapped,
            settlementBatchId: s.settlementBatchId,
          },
          'reconciler healed drifted session',
        );
      } else {
        // Confirmed still in-flight (Carret agrees with us). Skip event
        // spam — only log convergence and the healing case.
        out.unchanged += 1;
        out.details.push({
          sessionId: s.id, carretOrderId: String(s.carretOrderId),
          from: s.status, to: mapped ?? null,
          settlementBatchId: s.settlementBatchId ?? null,
          outcome: 'unchanged',
        });
      }
    } catch (e) {
      out.failed += 1;
      out.details.push({
        sessionId: s.id, carretOrderId: String(s.carretOrderId),
        from: s.status, to: null,
        settlementBatchId: s.settlementBatchId ?? null,
        outcome: 'failed', error: (e as Error).message,
      });
      logger.warn({ err: e, sessionId: s.id }, 'reconcile call failed');
    }
  }

  if (out.scanned > 0) {
    logger.info(
      { scanned: out.scanned, healed: out.healed, unchanged: out.unchanged, failed: out.failed },
      'offramp reconciler pass complete',
    );
  }
  return out;
}
