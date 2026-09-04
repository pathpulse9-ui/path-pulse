import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, db, closeDb } from '../db/client.js';
import { withRetry, listAttempts, recordBatch, attachDisbursement, getDisbursementId } from './payoutAttempts.js';

function httpError(message: string, status: number): Error {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

const ids: string[] = [];
function batchId(label: string): string {
  const id = `test_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  ids.push(id);
  return id;
}

before(async () => {
  await migrate();
});

after(async () => {
  if (ids.length) {
    await db().query('delete from payout_attempts where batch_id = any($1)', [ids]);
    await db().query('delete from payout_batches where id = any($1)', [ids]);
  }
  await closeDb();
});

test('succeeds first try and records one attempt', async () => {
  const id = batchId('ok');
  const result = await withRetry(id, 'createDisbursement', async () => 'disb-1');
  assert.equal(result, 'disb-1');

  const attempts = await listAttempts(id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].outcome, 'success');
  assert.equal(attempts[0].attempt, 1);
});

test('recovers from a transient failure and records both attempts', async () => {
  const id = batchId('retry');
  let calls = 0;
  const result = await withRetry(
    id,
    'startDisbursement',
    async () => {
      calls += 1;
      if (calls === 1) throw httpError('SDP unavailable', 503);
      return 'started';
    },
    { baseDelayMs: 1 },
  );

  assert.equal(result, 'started');
  assert.equal(calls, 2);

  const attempts = await listAttempts(id);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].outcome, 'failure');
  assert.match(attempts[0].error ?? '', /SDP unavailable/);
  assert.equal(attempts[1].outcome, 'success');
});

test('gives up after the attempt budget and records every failure', async () => {
  const id = batchId('exhaust');
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        id,
        'uploadInstructions',
        async () => {
          calls += 1;
          throw httpError('gateway timeout', 504);
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    /gateway timeout/,
  );

  assert.equal(calls, 3);
  const attempts = await listAttempts(id);
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every((a) => a.outcome === 'failure'));
});

test('does not retry a non-retryable 4xx', async () => {
  const id = batchId('fatal');
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        id,
        'createDisbursement',
        async () => {
          calls += 1;
          throw httpError('invalid asset_id', 400);
        },
        { attempts: 5, baseDelayMs: 1 },
      ),
    /invalid asset_id/,
  );

  assert.equal(calls, 1);
  const attempts = await listAttempts(id);
  assert.equal(attempts.length, 1);
});

test('disbursement id survives so a resumed batch is not duplicated', async () => {
  const id = batchId('resume');
  await recordBatch(id, 'stl_test', 'USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  assert.equal(await getDisbursementId(id), null);

  await attachDisbursement(id, 'disb-resume-1');
  assert.equal(await getDisbursementId(id), 'disb-resume-1');

  await recordBatch(id, 'stl_test', 'USDC', undefined);
  assert.equal(await getDisbursementId(id), 'disb-resume-1');
});
