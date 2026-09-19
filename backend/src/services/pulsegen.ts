import { createHash } from 'node:crypto';
import type { ScoreSource, ValidationScore } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { getLatestScore, type ScoreInput } from './scoreStore.js';

/**
 * PulseGen score feed (D6).
 *
 * PulseGen is PathPulse.ai's own contributor-validation engine and an external
 * dependency of this system — it decides whether a contributor's submissions
 * are trustworthy, and the SCOUT multiplier turns that judgement into money.
 * This module is the contract it satisfies, so the settlement engine never
 * learns which feed produced a score.
 *
 * Three sources, tried in order, each stamping its own `source` so a score can
 * always be traced to where it came from:
 *
 *   1. `pulsegen` live  — REST call, active once PULSEGEN_BASE_URL + API key are set.
 *   2. `pulsegen` batch — a score delivered by PathPulse.ai and imported with
 *      provenance (supplier, arrival time, operator, payload hash).
 *   3. `synthetic`      — the interim the 75-day plan's risk register sanctioned
 *      ("use synthetic scores until the live feed lands"), derived from the
 *      driver id so it is stable and cannot be hand-picked.
 *
 * No path accepts a caller-supplied score. That is the point: a tier is worth
 * 1.0x, 1.2x or 1.5x of a contributor's pay, so an operator must not be able
 * to choose one.
 */

export interface ScoreProvider {
  readonly name: ScoreSource;
  readonly live: boolean;
  getScore(driverId: string): Promise<ValidationScore>;
}

export type FeedMode = 'pulsegen-live' | 'pulsegen-batch' | 'synthetic';

/**
 * A score plus where it actually came from. `importId` is set only when the
 * score was read from a delivered batch — a live-feed score belongs to no
 * batch, and attributing one to the most recent import would be a false
 * provenance claim.
 */
export interface ResolvedScore extends ValidationScore {
  via: FeedMode;
  importId: string | null;
}

function clamp(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

/**
 * Deterministic 0..1 from the driver id — first 4 bytes of SHA-256. Stable
 * across processes and restarts, so an assigned tier is reproducible by anyone
 * holding the driver id and demonstrably not chosen by us.
 *
 * A test fixture, not a product: it measures nothing. `config/env.ts` refuses
 * to boot on mainnet without a live feed, so it cannot reach production.
 */
export function syntheticScoreFor(driverId: string): number {
  const digest = createHash('sha256').update(driverId).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export const syntheticScoreProvider: ScoreProvider = {
  name: 'synthetic',
  live: false,

  async getScore(driverId): Promise<ValidationScore> {
    return {
      driverId,
      score: clamp(syntheticScoreFor(driverId)),
      scoredAt: new Date().toISOString(),
      source: 'synthetic',
    };
  },
};

/**
 * Live PulseGen feed. Shape per the score-feed contract
 * (`docs/SCORE_FEED_CONTRACT.md`): bearer-authenticated
 * `GET {base}/v1/drivers/{driverId}/validation-score` → `{ score, scored_at }`.
 * Inert until both env vars are set.
 */
export const pulseGenScoreProvider: ScoreProvider = {
  name: 'pulsegen',
  live: true,

  async getScore(driverId): Promise<ValidationScore> {
    const base = env.pulseGen.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/v1/drivers/${encodeURIComponent(driverId)}/validation-score`, {
      headers: { Authorization: `Bearer ${env.pulseGen.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`PulseGen returned ${res.status} for driver ${driverId}`);
    const body = (await res.json()) as { score?: number; scored_at?: string };
    if (typeof body.score !== 'number') {
      throw new Error(`PulseGen returned no score for driver ${driverId}`);
    }
    return {
      driverId,
      score: clamp(body.score),
      scoredAt: body.scored_at ?? new Date().toISOString(),
      source: 'pulsegen',
    };
  },
};

/**
 * Read at call time, not at import: the endpoint can be pointed at a local
 * stub during integration testing without reloading the module.
 */
export function pulseGenLive(): boolean {
  return !!env.pulseGen?.baseUrl && !!env.pulseGen?.apiKey;
}

/** Host the live feed is configured against — surfaced so a stub is never mistaken for the real feed. */
export function pulseGenEndpointHost(): string | null {
  if (!pulseGenLive()) return null;
  try {
    return new URL(env.pulseGen.baseUrl).host;
  } catch {
    return env.pulseGen.baseUrl;
  }
}

/**
 * Resolve a driver's score from the best available source.
 *
 * A live-feed failure falls through to an imported batch rather than throwing:
 * an outage at PathPulse.ai must not strand a settlement, and the returned
 * score still says which source answered.
 */
export async function resolveScore(driverId: string): Promise<ResolvedScore> {
  if (pulseGenLive()) {
    try {
      const live = await pulseGenScoreProvider.getScore(driverId);
      return { ...live, via: 'pulsegen-live', importId: null };
    } catch {
      // fall through to the last delivered batch
    }
  }

  const imported = await getLatestScore(driverId);
  if (imported) {
    return {
      driverId: imported.driverId,
      score: imported.score,
      scoredAt: imported.scoredAt,
      source: imported.source,
      via: 'pulsegen-batch',
      importId: imported.importId,
    };
  }

  return { ...(await syntheticScoreProvider.getScore(driverId)), via: 'synthetic', importId: null };
}

/** Which source would answer right now, for the ops feed panel. */
export async function feedMode(driverId?: string): Promise<FeedMode> {
  if (pulseGenLive()) return 'pulsegen-live';
  if (driverId && (await getLatestScore(driverId))) return 'pulsegen-batch';
  return 'synthetic';
}

export function scoreProvider(): ScoreProvider {
  return pulseGenLive() ? pulseGenScoreProvider : syntheticScoreProvider;
}

const MAX_BATCH = 10_000;

export interface ParsedBatch {
  scores: ScoreInput[];
}

/**
 * Validate a delivered batch. Rejects the whole batch on any bad row: a
 * partially-applied import would leave some drivers scored and others silently
 * not, and the provenance record would overstate what landed.
 */
export function validateScoreBatch(rows: unknown): ParsedBatch {
  if (!Array.isArray(rows)) throw batchError('scores must be an array');
  if (rows.length === 0) throw batchError('scores must not be empty');
  if (rows.length > MAX_BATCH) throw batchError(`scores exceeds the ${MAX_BATCH}-row limit`);

  const seen = new Set<string>();
  const now = Date.now();
  const scores: ScoreInput[] = [];

  rows.forEach((raw, i) => {
    const row = raw as Record<string, unknown>;
    const at = `scores[${i}]`;

    const driverId = typeof row.driverId === 'string' ? row.driverId.trim() : '';
    if (!driverId) throw batchError(`${at}.driverId must be a non-empty string`);
    if (seen.has(driverId)) throw batchError(`${at}.driverId "${driverId}" appears twice`);
    seen.add(driverId);

    const score = typeof row.score === 'number' ? row.score : Number(row.score);
    if (!Number.isFinite(score)) throw batchError(`${at}.score must be a number`);
    if (score < 0 || score > 1) throw batchError(`${at}.score must be between 0 and 1`);

    const scoredAtRaw = typeof row.scoredAt === 'string' ? row.scoredAt : '';
    const scoredAt = Date.parse(scoredAtRaw);
    if (Number.isNaN(scoredAt)) throw batchError(`${at}.scoredAt must be an ISO-8601 timestamp`);
    if (scoredAt > now + 5 * 60 * 1000) throw batchError(`${at}.scoredAt is in the future`);

    scores.push({ driverId, score, scoredAt: new Date(scoredAt).toISOString() });
  });

  return { scores };
}

/**
 * CSV delivery — `driver_id,score,scored_at` with a header row. PathPulse.ai's
 * scoring is not yet an API, so a spreadsheet export is a realistic delivery
 * format and is still a real validation result.
 */
export function parseScoreCsv(csv: string): unknown[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw batchError('csv needs a header row and at least one score');

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = {
    driverId: header.indexOf('driver_id'),
    score: header.indexOf('score'),
    scoredAt: header.indexOf('scored_at'),
  };
  for (const [field, i] of Object.entries(idx)) {
    if (i === -1) throw batchError(`csv header is missing a column for ${field}`);
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    return {
      driverId: cells[idx.driverId],
      score: Number(cells[idx.score]),
      scoredAt: cells[idx.scoredAt],
    };
  });
}

function batchError(message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ValidationError';
  e.status = 400;
  return e;
}
