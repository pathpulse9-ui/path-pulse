import type { ScoreSource, ValidationScore } from '@pathpulse/contract';
import { env } from '../config/env.js';

/**
 * PulseGen score feed (D6).
 *
 * SCOUT tiers are derived from PulseGen validation scores. The live feed is an
 * external dependency, so this is the contract it will satisfy — the same
 * provider shape used for the off-ramp, so the settlement engine never learns
 * which feed produced a score.
 *
 * `synthetic` is the agreed interim: the 75-day plan's risk register calls for
 * defining this contract up front and using synthetic scores until the live
 * feed lands. A synthetic score is supplied by the caller and is recorded as
 * such on every assignment, so no tier can be mistaken for one PulseGen issued.
 */
export interface ScoreProvider {
  readonly name: ScoreSource;
  readonly live: boolean;
  getScore(driverId: string, suppliedScore?: number): Promise<ValidationScore>;
}

function clamp(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

export const syntheticScoreProvider: ScoreProvider = {
  name: 'synthetic',
  live: false,

  async getScore(driverId, suppliedScore = 0): Promise<ValidationScore> {
    return {
      driverId,
      score: clamp(suppliedScore),
      scoredAt: new Date().toISOString(),
      source: 'synthetic',
    };
  },
};

export const pulseGenLive = !!env.pulseGen?.baseUrl && !!env.pulseGen?.apiKey;

export function scoreProvider(): ScoreProvider {
  return syntheticScoreProvider;
}
