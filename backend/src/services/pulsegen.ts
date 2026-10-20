import { createHash } from 'node:crypto';
import type { ScoreSource, ValidationScore } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { getLatestScore, type ScoreInput } from './scoreStore.js';
import { pathpulseInternalScoreProvider } from './pathpulseInternalScore.js';

export interface ScoreProvider {
  readonly name: ScoreSource;
  readonly live: boolean;
  getScore(driverId: string): Promise<ValidationScore>;
}

export type FeedMode = 'pulsegen-live' | 'pulsegen-batch' | 'pathpulse-internal' | 'derived';

export interface ResolvedScore extends ValidationScore {
  via: FeedMode;
  importId: string | null;
}

function clamp(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

export function derivedScoreFor(driverId: string): number {
  const digest = createHash('sha256').update(driverId).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export const derivedScoreProvider: ScoreProvider = {
  name: 'derived',
  live: false,

  async getScore(driverId): Promise<ValidationScore> {
    return {
      driverId,
      score: clamp(derivedScoreFor(driverId)),
      scoredAt: new Date().toISOString(),
      source: 'derived',
    };
  },
};

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

export function pulseGenLive(): boolean {
  return !!env.pulseGen?.baseUrl && !!env.pulseGen?.apiKey;
}

export function pulseGenEndpointHost(): string | null {
  if (!pulseGenLive()) return null;
  try {
    return new URL(env.pulseGen.baseUrl).host;
  } catch {
    return env.pulseGen.baseUrl;
  }
}

export function pathpulseInternalLive(): boolean {
  return !!env.pulseGen?.internal;
}

const SCORED_AT_SKEW_MS = 30 * 1000;

export async function resolveScore(driverId: string): Promise<ResolvedScore> {
  if (pulseGenLive()) {
    try {
      const live = await pulseGenScoreProvider.getScore(driverId);
      return { ...live, via: 'pulsegen-live', importId: null };
    } catch {}
  }

  if (pathpulseInternalLive()) {
    try {
      const internal = await pathpulseInternalScoreProvider.getScore(driverId);
      return { ...internal, via: 'pathpulse-internal', importId: null };
    } catch {}
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

  if (env.network === 'mainnet') {
    const e = new Error(
      `No PulseGen score for driver ${driverId} — import it with POST /v1/ops/scores/import before using it on mainnet`,
    ) as Error & { status: number };
    e.name = 'NoValidationScore';
    e.status = 422;
    throw e;
  }
  return { ...(await derivedScoreProvider.getScore(driverId)), via: 'derived', importId: null };
}

export async function feedMode(driverId?: string): Promise<FeedMode> {
  if (pulseGenLive()) return 'pulsegen-live';
  if (pathpulseInternalLive()) return 'pathpulse-internal';
  if (driverId && (await getLatestScore(driverId))) return 'pulsegen-batch';
  return 'derived';
}

export function scoreProvider(): ScoreProvider {
  if (pulseGenLive()) return pulseGenScoreProvider;
  if (pathpulseInternalLive()) return pathpulseInternalScoreProvider;
  return derivedScoreProvider;
}

const MAX_BATCH = 10_000;

export interface ParsedBatch {
  scores: ScoreInput[];
}

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
    if (scoredAt > now + SCORED_AT_SKEW_MS) throw batchError(`${at}.scoredAt is in the future`);

    scores.push({ driverId, score, scoredAt: new Date(scoredAt).toISOString() });
  });

  return { scores };
}

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
