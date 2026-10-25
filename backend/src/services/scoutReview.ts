import type { ScoutTier } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { assignTierForDriver, getOnchainTier, retainedTier, revokeTier } from '../stellar/scout.js';
import { resolveScore } from './pulsegen.js';
import { latestAssignments } from './scoreStore.js';
import { sendAlertInBackground } from './alerts.js';

export interface ScoutReviewOutcome {
  driverId: string;
  address: string;
  held: ScoutTier;
  kept: ScoutTier;
  action: 'kept' | 'demoted' | 'revoked' | 'failed';
}

export async function reviewScoutBadges(now = Date.now()): Promise<ScoutReviewOutcome[]> {
  const outcomes: ScoutReviewOutcome[] = [];
  for (const assignment of await latestAssignments(500)) {
    const { tier: held } = await getOnchainTier(assignment.address).catch(() => ({ tier: null }));
    if (!held || held === 1) continue;
    const score = await resolveScore(assignment.driverId).catch(() => undefined);
    const kept = retainedTier(held, score?.score, score?.scoredAt, now);
    const base = { driverId: assignment.driverId, address: assignment.address, held, kept };
    if (kept === held) {
      outcomes.push({ ...base, action: 'kept' });
      continue;
    }
    try {
      if (kept === 1) {
        await revokeTier(assignment.address);
        outcomes.push({ ...base, action: 'revoked' });
      } else {
        await assignTierForDriver(assignment.driverId, kept);
        outcomes.push({ ...base, action: 'demoted' });
      }
    } catch (e) {
      logger.error({ err: e, driverId: assignment.driverId }, 'SCOUT badge review could not change a badge');
      outcomes.push({ ...base, action: 'failed' });
    }
  }
  const failed = outcomes.filter((o) => o.action === 'failed');
  if (failed.length) {
    sendAlertInBackground({
      key: 'scout:review:failed',
      severity: 'critical',
      title: 'SCOUT badge review could not demote every driver',
      detail: failed.map((o) => `${o.driverId} holds SCOUT${o.held}, should hold SCOUT${o.kept}`).join('; '),
    });
  }
  return outcomes;
}

export function startScoutReview(intervalMs = env.scoutReview.intervalMs): void {
  if (!env.databaseUrl || intervalMs <= 0) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const outcomes = await reviewScoutBadges();
      const changed = outcomes.filter((o) => o.action !== 'kept');
      if (changed.length) logger.info({ changed }, 'SCOUT badge review applied');
    } catch (e) {
      logger.error({ err: e }, 'SCOUT badge review failed');
    } finally {
      running = false;
    }
  };
  setInterval(tick, intervalMs).unref?.();
}
