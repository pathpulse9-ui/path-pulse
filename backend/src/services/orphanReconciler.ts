import { env, numEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { carretLive } from '../config/env.js';
import { carretTimestampMs, listOfframpOrders, mapCarretStatus, type CarretOrder } from './carret.js';
import { listOrphanCandidates, type OrphanCandidate } from './offRampStore.js';
import { attachCarretOrder, reconcileSessionStatus } from './offramp.js';


const INTERVAL_MS = numEnv('CARRET_RECONCILER_INTERVAL_MS', 60_000, 1);
const STALE_SECONDS = numEnv('CARRET_RECONCILER_STALE_SECONDS', 30);
const MATCH_WINDOW_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export interface ReconcileOutcome {
  sessionId: string;
  settlementBatchId: string | null;
  carretOrderId: string | null;
  matchedBy: 'order_id' | 'amount_and_time' | null;
  from: string;
  to: string | null;
  action: 'recovered' | 'unchanged' | 'unmatched' | 'failed';
  error?: string;
}

export interface ReconcileReport {
  scanned: number;
  recovered: number;
  unmatched: number;
  failed: number;
  outcomes: ReconcileOutcome[];
}

export interface ReconcileDeps {
  listOrders: (accountId: number | string) => Promise<CarretOrder[]>;
}

const liveDeps: ReconcileDeps = { listOrders: (accountId) => listOfframpOrders(accountId) };

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
  timer.unref?.();
  logger.info({ intervalMs: INTERVAL_MS, staleSeconds: STALE_SECONDS }, 'orphan reconciler started');
}

export function stopOrphanReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function reconcileOnce(deps: ReconcileDeps = liveDeps): Promise<ReconcileReport> {
  const candidates = await listOrphanCandidates(STALE_SECONDS).catch((e) => {
    logger.debug({ err: e }, 'reconcile query skipped');
    return [] as OrphanCandidate[];
  });

  const report: ReconcileReport = {
    scanned: candidates.length,
    recovered: 0,
    unmatched: 0,
    failed: 0,
    outcomes: [],
  };

  const ordersByAccount = new Map<string, CarretOrder[]>();
  const claimed = new Set(
    candidates.map((c) => c.carretOrderId).filter((id): id is string => Boolean(id)),
  );

  for (const candidate of candidates) {
    const accountId = candidate.carretAccountId ?? String(env.carret.accountId ?? '');
    if (!accountId) {
      report.unmatched += 1;
      report.outcomes.push(outcome(candidate, null, null, 'unmatched'));
      continue;
    }

    try {
      if (!ordersByAccount.has(accountId)) {
        ordersByAccount.set(accountId, await deps.listOrders(accountId));
      }
      const orders = ordersByAccount.get(accountId) ?? [];

      const match = candidate.carretOrderId
        ? orders.find((o) => String(o.id) === candidate.carretOrderId)
        : matchByAmountAndTime(orders, candidate, claimed);

      if (!match) {
        report.unmatched += 1;
        report.outcomes.push(outcome(candidate, null, null, 'unmatched'));
        continue;
      }

      const matchedBy = candidate.carretOrderId ? 'order_id' : 'amount_and_time';
      if (matchedBy === 'amount_and_time') {
        claimed.add(String(match.id));
        await attachCarretOrder(candidate.sessionId, String(match.id));
      }

      const mapped = mapCarretStatus(match.status);
      if (!mapped || mapped === candidate.status) {
        report.outcomes.push(outcome(candidate, String(match.id), matchedBy, 'unchanged'));
        continue;
      }

      await reconcileSessionStatus(candidate.sessionId, mapped, {
        carretOrderId: String(match.id),
        carretStatus: match.status,
        matchedBy,
        settlementBatchId: candidate.settlementBatchId,
      });
      report.recovered += 1;
      report.outcomes.push({
        ...outcome(candidate, String(match.id), matchedBy, 'recovered'),
        to: mapped,
      });
      logger.info(
        {
          sessionId: candidate.sessionId,
          carretOrderId: String(match.id),
          settlementBatchId: candidate.settlementBatchId,
          from: candidate.status,
          to: mapped,
          matchedBy,
        },
        'orphan session recovered from Carret order list',
      );
    } catch (e) {
      report.failed += 1;
      report.outcomes.push({
        ...outcome(candidate, candidate.carretOrderId, null, 'failed'),
        error: (e as Error).message,
      });
      logger.warn({ err: e, sessionId: candidate.sessionId }, 'orphan reconcile call failed');
    }
  }

  if (report.scanned > 0) {
    logger.info(
      { scanned: report.scanned, recovered: report.recovered, unmatched: report.unmatched, failed: report.failed },
      'orphan reconciler pass complete',
    );
  }
  return report;
}

function matchByAmountAndTime(
  orders: CarretOrder[],
  candidate: OrphanCandidate,
  claimed: Set<string>,
): CarretOrder | undefined {
  const createdAt = new Date(candidate.createdAt).getTime();
  const wanted = Number(candidate.amount);

  return orders.find((o) => {
    if (claimed.has(String(o.id))) return false;
    if (Number(o.asked_quantity) !== wanted) return false;
    const placedAt = carretTimestampMs(o.created_at);
    if (placedAt === null) return false;
    return Math.abs(placedAt - createdAt) <= MATCH_WINDOW_MS;
  });
}

function outcome(
  candidate: OrphanCandidate,
  carretOrderId: string | null,
  matchedBy: ReconcileOutcome['matchedBy'],
  action: ReconcileOutcome['action'],
): ReconcileOutcome {
  return {
    sessionId: candidate.sessionId,
    settlementBatchId: candidate.settlementBatchId,
    carretOrderId,
    matchedBy,
    from: candidate.status,
    to: null,
    action,
  };
}
