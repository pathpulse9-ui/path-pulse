import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../config/env.js';
import { migrate, db, closeDb } from '../db/client.js';
import {
  saveSession,
  getSession,
  listEvents,
  _resetInMemoryForTests,
  type StoredOffRampSession,
} from './offRampStore.js';
import { reconcileOnce, type ReconcileDeps } from './orphanReconciler.js';
import { carretTimestampMs, type CarretOrder } from './carret.js';

/**
 * D4 recovery proof: an off-ramp session whose Carret webhook never arrived,
 * and one whose `place_order` was interrupted before we learned the order id,
 * are both converged by the reconciler — and both stay linked to the
 * settlement batch they draw from.
 *
 * Mirrors `payoutAttempts.test.ts`: needs a live Postgres at DATABASE_URL and
 * self-skips when one isn't up, so a dev machine without Docker stays green.
 */

let dbAvailable = false;
const ids: string[] = [];

function sessionId(label: string): string {
  const id = `ofr_test_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  ids.push(id);
  return id;
}

const BATCH_ID = 'stl_test_reconciler_batch';

function session(overrides: Partial<StoredOffRampSession> & { id: string }): StoredOffRampSession {
  const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return {
    provider: 'carret',
    sandbox: false,
    status: 'pending_anchor',
    interactiveUrl: 'https://example.invalid/offramp',
    amount: '10',
    asset: { code: 'USDC' },
    fiatCurrency: 'INR',
    settlementBatchId: BATCH_ID,
    ppUserId: `user_${overrides.id}`,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function order(o: Partial<CarretOrder> & { id: string }): CarretOrder {
  return {
    status: 'filled',
    asked_quantity: '10',
    payment_method: 'bank_transfer',
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ...o,
  };
}

before(async () => {
  _resetInMemoryForTests();
  if (!env.databaseUrl) return;
  try {
    await migrate();
    dbAvailable = true;
  } catch (e) {
    console.warn(
      `[orphanReconciler.test] DB unreachable at DATABASE_URL, skipping suite: ${(e as Error).message}`,
    );
  }
});

after(async () => {
  if (dbAvailable && ids.length) {
    await db().query('delete from off_ramp_status_events where session_id = any($1)', [ids]);
    await db().query('delete from off_ramp_sessions where id = any($1)', [ids]);
  }
  await closeDb();
});

test('a missed webhook is recovered from the Carret order list and keeps its batch link', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = sessionId('missedcb');
  await saveSession(session({ id, carretOrderId: '9001' }));

  const deps: ReconcileDeps = { listOrders: async () => [order({ id: '9001', status: 'filled' })] };
  const report = await reconcileOnce(deps);

  const outcome = report.outcomes.find((o) => o.sessionId === id);
  assert.ok(outcome, 'session was scanned');
  assert.equal(outcome.action, 'recovered');
  assert.equal(outcome.matchedBy, 'order_id');
  assert.equal(outcome.from, 'pending_anchor');
  assert.equal(outcome.to, 'completed');
  assert.equal(outcome.settlementBatchId, BATCH_ID);

  const after = await getSession(id);
  assert.equal(after?.status, 'completed');
  assert.equal(after?.settlementBatchId, BATCH_ID);

  const events = await listEvents(id);
  const recovery = events.find((e) => e.source === 'reconciler');
  assert.ok(recovery, 'the transition is recorded as a reconciler event');
  assert.equal(recovery.previousStatus, 'pending_anchor');
  assert.equal(recovery.status, 'completed');
  assert.equal(recovery.detail?.carretOrderId, '9001');
});

test('an interrupted place_order is matched on amount and time, then bound to its order', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = sessionId('interrupted');
  const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await saveSession(
    session({ id, amount: '11', createdAt, updatedAt: createdAt, carretOrderId: undefined }),
  );

  const deps: ReconcileDeps = {
    listOrders: async () => [
      order({ id: '9002', status: 'filled', asked_quantity: '11', created_at: createdAt }),
    ],
  };
  const report = await reconcileOnce(deps);

  const outcome = report.outcomes.find((o) => o.sessionId === id);
  assert.ok(outcome, 'session was scanned');
  assert.equal(outcome.action, 'recovered');
  assert.equal(outcome.matchedBy, 'amount_and_time');
  assert.equal(outcome.carretOrderId, '9002');

  const after = await getSession(id);
  assert.equal(after?.carretOrderId, '9002');
  assert.equal(after?.status, 'completed');
  assert.equal(after?.settlementBatchId, BATCH_ID);
});

test('an order outside the match window is left alone rather than mis-bound', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = sessionId('nomatch');
  await saveSession(session({ id, amount: '12', carretOrderId: undefined }));

  const deps: ReconcileDeps = {
    listOrders: async () => [
      order({
        id: '9003',
        asked_quantity: '12',
        created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      }),
    ],
  };
  const report = await reconcileOnce(deps);

  const outcome = report.outcomes.find((o) => o.sessionId === id);
  assert.equal(outcome?.action, 'unmatched');
  assert.equal((await getSession(id))?.carretOrderId, undefined);
});

test('one Carret order cannot be credited to two interrupted sessions', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const first = sessionId('dupe1');
  const second = sessionId('dupe2');
  await saveSession(session({ id: first, amount: '13', createdAt, updatedAt: createdAt }));
  await saveSession(session({ id: second, amount: '13', createdAt, updatedAt: createdAt }));

  const deps: ReconcileDeps = {
    listOrders: async () => [order({ id: '9004', asked_quantity: '13', created_at: createdAt })],
  };
  const report = await reconcileOnce(deps);

  const bound = report.outcomes.filter((o) => o.carretOrderId === '9004' && o.action === 'recovered');
  assert.equal(bound.length, 1, 'exactly one session claims the order');
  assert.ok(
    [first, second].includes(bound[0].sessionId),
    'the claim went to one of the two duplicate sessions',
  );
  const loser = bound[0].sessionId === first ? second : first;
  assert.equal(report.outcomes.find((o) => o.sessionId === loser)?.action, 'unmatched');
});

test('Carret epoch-second timestamps are normalised, not read as milliseconds', () => {
  assert.equal(carretTimestampMs(1787125834.933947), 1787125834934);
  assert.equal(carretTimestampMs('1787125834.933947'), 1787125834934);
  assert.equal(carretTimestampMs('2026-08-24T12:30:34.933Z'), Date.parse('2026-08-24T12:30:34.933Z'));
  assert.equal(carretTimestampMs(undefined), null);
});

test('an interrupted session matches an order timestamped in epoch seconds', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL unreachable');

  const id = sessionId('epoch');
  const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await saveSession(
    session({ id, amount: '14', createdAt, updatedAt: createdAt, carretOrderId: undefined }),
  );

  const deps: ReconcileDeps = {
    listOrders: async () => [
      order({
        id: '9005',
        asked_quantity: '14.0000000000',
        created_at: new Date(createdAt).getTime() / 1000,
      }),
    ],
  };
  const report = await reconcileOnce(deps);

  const outcome = report.outcomes.find((o) => o.sessionId === id);
  assert.equal(outcome?.action, 'recovered', 'epoch-second order was matched');
  assert.equal(outcome?.carretOrderId, '9005');
});
