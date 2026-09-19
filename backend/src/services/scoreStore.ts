import { randomBytes, createHash } from 'node:crypto';
import type { ScoreSource, ValidationScore } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';

/**
 * Score-feed store (D6) — dual-mode, mirroring `settlementStore`.
 *
 * PulseGen is PathPulse.ai's own validation engine and an external dependency
 * of this system. Until a live endpoint exists, its results arrive as batches.
 * A delivered score is only defensible if you can say where it came from, so
 * every batch records its supplier, arrival time, the operator who imported it
 * and a SHA-256 of the exact payload — and every score points at its batch.
 *
 * What that provenance attests to is **receipt, not correctness**: it proves a
 * number was supplied by a named party at a known time, not that the number is
 * right. That distinction is deliberate and must survive into anything built
 * on top of it.
 *
 * Scores are append-only. The newest row for a driver is their current score;
 * history is retained so a past tier assignment stays explainable.
 */

export interface ScoreImportMeta {
  supplier: string;
  sourceRef?: string;
  notes?: string;
  importedBy: string;
  receivedAt: string;
  payloadSha256: string;
}

export interface ScoreImport extends ScoreImportMeta {
  id: string;
  scoreCount: number;
  createdAt: string;
}

export interface ScoreInput {
  driverId: string;
  score: number;
  scoredAt: string;
}

export interface StoredScore extends ValidationScore {
  importId: string | null;
}

const memImports: ScoreImport[] = [];
const memScores: (StoredScore & { importId: string | null })[] = [];

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
}

export function hashPayload(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newImportId(): string {
  return `imp_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * Persist a batch and its scores atomically. A partial import would leave the
 * feed claiming provenance it cannot honour, so on any failure nothing lands.
 */
export async function saveImport(
  meta: ScoreImportMeta,
  scores: ScoreInput[],
): Promise<ScoreImport> {
  const record: ScoreImport = {
    ...meta,
    id: newImportId(),
    scoreCount: scores.length,
    createdAt: new Date().toISOString(),
  };

  if (!hasDb()) {
    memImports.unshift(record);
    for (const s of scores) {
      memScores.push({ ...s, source: 'pulsegen', importId: record.id });
    }
    return record;
  }

  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into score_imports
         (id, supplier, source_ref, payload_sha256, score_count, imported_by, received_at, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.supplier,
        record.sourceRef ?? null,
        record.payloadSha256,
        record.scoreCount,
        record.importedBy,
        record.receivedAt,
        record.notes ?? null,
      ],
    );
    for (const s of scores) {
      await client.query(
        `insert into driver_scores (driver_id, score, scored_at, source, import_id)
         values ($1, $2, $3, 'pulsegen', $4)
         on conflict (driver_id, scored_at, source) do update
           set score = excluded.score, import_id = excluded.import_id`,
        [s.driverId, s.score, s.scoredAt, record.id],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }

  return record;
}

export async function getLatestScore(driverId: string): Promise<StoredScore | null> {
  if (!hasDb()) {
    const rows = memScores
      .filter((s) => s.driverId === driverId)
      .sort((a, b) => b.scoredAt.localeCompare(a.scoredAt));
    return rows[0] ?? null;
  }
  const res = await db().query<ScoreRow>(
    `select driver_id, score, scored_at, source, import_id
     from driver_scores
     where driver_id = $1
     order by scored_at desc, id desc
     limit 1`,
    [driverId],
  );
  return res.rows[0] ? rowToScore(res.rows[0]) : null;
}

export async function listImports(limit = 20): Promise<ScoreImport[]> {
  if (!hasDb()) return memImports.slice(0, limit);
  const res = await db().query<ImportRow>(
    `select * from score_imports order by received_at desc limit $1`,
    [Math.min(Math.max(1, limit), 100)],
  );
  return res.rows.map(rowToImport);
}

export async function getImport(id: string): Promise<ScoreImport | null> {
  if (!hasDb()) return memImports.find((i) => i.id === id) ?? null;
  const res = await db().query<ImportRow>('select * from score_imports where id = $1', [id]);
  return res.rows[0] ? rowToImport(res.rows[0]) : null;
}

export async function listScores(importId: string): Promise<StoredScore[]> {
  if (!hasDb()) return memScores.filter((s) => s.importId === importId);
  const res = await db().query<ScoreRow>(
    `select driver_id, score, scored_at, source, import_id
     from driver_scores where import_id = $1 order by driver_id`,
    [importId],
  );
  return res.rows.map(rowToScore);
}

/** Newest score per driver, for the feed panel. */
export async function listLatestScores(limit = 100): Promise<StoredScore[]> {
  if (!hasDb()) {
    const byDriver = new Map<string, StoredScore>();
    for (const s of [...memScores].sort((a, b) => a.scoredAt.localeCompare(b.scoredAt))) {
      byDriver.set(s.driverId, s);
    }
    return [...byDriver.values()].slice(0, limit);
  }
  const res = await db().query<ScoreRow>(
    `select distinct on (driver_id) driver_id, score, scored_at, source, import_id
     from driver_scores
     order by driver_id, scored_at desc, id desc
     limit $1`,
    [Math.min(Math.max(1, limit), 500)],
  );
  return res.rows.map(rowToScore);
}

export async function countScores(): Promise<number> {
  if (!hasDb()) return new Set(memScores.map((s) => s.driverId)).size;
  const res = await db().query<{ n: string }>('select count(distinct driver_id) as n from driver_scores');
  return Number(res.rows[0]?.n ?? 0);
}

/** Only called by test fixtures — never in prod. */
export function _resetInMemoryForTests(): void {
  memImports.length = 0;
  memScores.length = 0;
}

type ImportRow = {
  id: string;
  supplier: string;
  source_ref: string | null;
  payload_sha256: string;
  score_count: number;
  imported_by: string;
  received_at: Date;
  created_at: Date;
  notes: string | null;
};

type ScoreRow = {
  driver_id: string;
  score: string;
  scored_at: Date;
  source: string;
  import_id: string | null;
};

function rowToImport(r: ImportRow): ScoreImport {
  return {
    id: r.id,
    supplier: r.supplier,
    sourceRef: r.source_ref ?? undefined,
    payloadSha256: r.payload_sha256,
    scoreCount: r.score_count,
    importedBy: r.imported_by,
    receivedAt: r.received_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    notes: r.notes ?? undefined,
  };
}

function rowToScore(r: ScoreRow): StoredScore {
  return {
    driverId: r.driver_id,
    score: Number(r.score),
    scoredAt: r.scored_at.toISOString(),
    source: r.source as ScoreSource,
    importId: r.import_id,
  };
}
