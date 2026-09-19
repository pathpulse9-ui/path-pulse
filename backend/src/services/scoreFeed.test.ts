import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../config/env.js';
import { migrate, db, closeDb } from '../db/client.js';
import {
  parseScoreCsv,
  resolveScore,
  syntheticScoreFor,
  validateScoreBatch,
} from './pulsegen.js';
import {
  getLatestScore,
  hashPayload,
  listLatestScores,
  saveImport,
  _resetInMemoryForTests,
} from './scoreStore.js';

/**
 * D6 score feed: a delivered PulseGen result must be traceable to the batch
 * that delivered it, must beat the synthetic interim, and a malformed batch
 * must land nothing at all.
 *
 * Mirrors `payoutAttempts.test.ts`: needs Postgres at DATABASE_URL and
 * self-skips when one isn't up.
 */

let dbAvailable = false;
const driverIds: string[] = [];
const importIds: string[] = [];

function driver(label: string): string {
  const id = `drv_test_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  driverIds.push(id);
  return id;
}

before(async () => {
  _resetInMemoryForTests();
  if (!env.databaseUrl) return;
  try {
    await migrate();
    dbAvailable = true;
  } catch (e) {
    console.warn(`[scoreFeed.test] DB unreachable, skipping suite: ${(e as Error).message}`);
  }
});

after(async () => {
  if (dbAvailable && driverIds.length) {
    await db().query('delete from driver_scores where driver_id = any($1)', [driverIds]);
    await db().query('delete from score_imports where id = any($1)', [importIds]);
  }
  await closeDb();
});

test('synthetic scores are deterministic and independently reproducible', () => {
  assert.equal(syntheticScoreFor('drv-pulsegen-demo-006'), syntheticScoreFor('drv-pulsegen-demo-006'));
  assert.ok(Math.abs(syntheticScoreFor('drv-pulsegen-demo-006') - 0.8329505575431861) < 1e-12);
  assert.notEqual(syntheticScoreFor('a'), syntheticScoreFor('b'));
});

test('a batch is rejected whole when any row is bad', () => {
  const good = { driverId: 'a', score: 0.5, scoredAt: '2026-09-01T00:00:00Z' };
  assert.throws(() => validateScoreBatch([good, { ...good, driverId: 'b', score: 1.4 }]), /between 0 and 1/);
  assert.throws(() => validateScoreBatch([good, { ...good }]), /appears twice/);
  assert.throws(() => validateScoreBatch([{ ...good, scoredAt: 'not-a-date' }]), /ISO-8601/);
  assert.throws(() => validateScoreBatch([{ ...good, driverId: '  ' }]), /non-empty/);
  assert.throws(() => validateScoreBatch([]), /must not be empty/);
  assert.throws(
    () => validateScoreBatch([{ ...good, scoredAt: new Date(Date.now() + 864e5).toISOString() }]),
    /in the future/,
  );
});

test('a valid batch normalises timestamps and preserves scores', () => {
  const { scores } = validateScoreBatch([
    { driverId: ' d1 ', score: 0.83, scoredAt: '2026-09-01T00:00:00Z' },
  ]);
  assert.equal(scores[0].driverId, 'd1');
  assert.equal(scores[0].score, 0.83);
  assert.equal(scores[0].scoredAt, '2026-09-01T00:00:00.000Z');
});

test('csv delivery parses and rejects a missing column', () => {
  const rows = parseScoreCsv('driver_id,score,scored_at\nd1,0.83,2026-09-01T00:00:00Z\n');
  assert.deepEqual(rows, [{ driverId: 'd1', score: 0.83, scoredAt: '2026-09-01T00:00:00Z' }]);
  assert.throws(() => parseScoreCsv('driver_id,score\nd1,0.83'), /missing a column for scoredAt/);
  assert.throws(() => parseScoreCsv('driver_id,score,scored_at'), /at least one score/);
});

test('payload hash is stable and content-addressed', () => {
  assert.equal(hashPayload('{"a":1}'), hashPayload('{"a":1}'));
  assert.notEqual(hashPayload('{"a":1}'), hashPayload('{"a":2}'));
  assert.match(hashPayload('x'), /^[0-9a-f]{64}$/);
});

test('an imported score carries its provenance and beats the synthetic interim', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = driver('imported');
  const synthetic = await resolveScore(id);
  assert.equal(synthetic.source, 'synthetic', 'unscored driver falls back to synthetic');

  const { scores } = validateScoreBatch([
    { driverId: id, score: 0.91, scoredAt: '2026-09-18T10:00:00Z' },
  ]);
  const record = await saveImport(
    {
      supplier: 'test-fixture-supplier',
      sourceRef: 'pulsegen-export-2026-09-18.csv',
      importedBy: 'ops_test',
      receivedAt: '2026-09-18T11:00:00Z',
      payloadSha256: hashPayload('fixture'),
    },
    scores,
  );
  importIds.push(record.id);

  assert.equal(record.scoreCount, 1);
  assert.equal(record.supplier, 'test-fixture-supplier');

  const resolved = await resolveScore(id);
  assert.equal(resolved.source, 'pulsegen', 'delivered score wins over synthetic');
  assert.equal(resolved.score, 0.91);
  assert.equal(resolved.scoredAt, '2026-09-18T10:00:00.000Z');

  const stored = await getLatestScore(id);
  assert.equal(stored?.importId, record.id, 'score points at the batch that delivered it');
});

test('the newest delivered score wins, and history is retained', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = driver('history');
  for (const [score, scoredAt] of [
    [0.4, '2026-09-01T00:00:00Z'],
    [0.85, '2026-09-15T00:00:00Z'],
  ] as const) {
    const { scores } = validateScoreBatch([{ driverId: id, score, scoredAt }]);
    const rec = await saveImport(
      {
        supplier: 'test-fixture-supplier',
        importedBy: 'ops_test',
        receivedAt: new Date().toISOString(),
        payloadSha256: hashPayload(`${id}-${scoredAt}`),
      },
      scores,
    );
    importIds.push(rec.id);
  }

  const resolved = await resolveScore(id);
  assert.equal(resolved.score, 0.85, 'newest scored_at wins regardless of import order');

  const rows = await db().query('select count(*)::int as n from driver_scores where driver_id = $1', [id]);
  assert.equal(rows.rows[0].n, 2, 'earlier score retained so past tiers stay explainable');
});

test('the feed listing returns one current row per driver', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = driver('listing');
  const { scores } = validateScoreBatch([
    { driverId: id, score: 0.62, scoredAt: '2026-09-17T00:00:00Z' },
  ]);
  const rec = await saveImport(
    {
      supplier: 'test-fixture-supplier',
      importedBy: 'ops_test',
      receivedAt: new Date().toISOString(),
      payloadSha256: hashPayload(id),
    },
    scores,
  );
  importIds.push(rec.id);

  const listed = (await listLatestScores(500)).filter((s) => s.driverId === id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].score, 0.62);
  assert.equal(listed[0].source, 'pulsegen');
});
