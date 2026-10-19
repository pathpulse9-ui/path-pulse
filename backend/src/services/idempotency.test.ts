import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

let server: Server | undefined;
let base = '';
let executions = 0;
let emptyExecutions = 0;
let failingExecutions = 0;
let cookieName = '';
let closeDb: () => Promise<void> = async () => {};
let createSessionToken: (p: { userId: string; method: 'google' | 'guest' }) => string = () => '';

before(async () => {
  if (skip) return;
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const dbModule = await import('../db/client.js');
  const { env } = await import('../config/env.js');
  const { idempotency } = await import('./idempotency.js');
  ({ createSessionToken } = await import('./session.js'));
  closeDb = dbModule.closeDb;
  cookieName = env.session.cookieName;
  await dbModule.migrate();

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.post('/move', idempotency(), async (req, res) => {
    executions += 1;
    await new Promise((r) => setTimeout(r, 300));
    res.status(201).json({ execution: executions, amount: req.body.amount });
  });
  app.post('/empty', idempotency(), (_req, res) => {
    emptyExecutions += 1;
    res.status(204).end();
  });
  app.post('/fails', idempotency(), (req, res) => {
    failingExecutions += 1;
    if (req.body.fundsMoved) res.locals.keepIdempotencyKey = true;
    res.status(req.body.status).json({ error: 'Failed' });
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await closeDb();
});

function send(userId: string, key: string, amount: string) {
  const token = createSessionToken({ userId, method: 'google' });
  return fetch(`${base}/move`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      cookie: `${cookieName}=${token}`,
    },
    body: JSON.stringify({ amount }),
  });
}

test('two concurrent requests with the same key execute once', { skip }, async () => {
  const before = executions;
  const key = randomUUID();
  const [a, b] = await Promise.all([send('user_a', key, '10'), send('user_a', key, '10')]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(((await loser.json()) as { error: string }).error, 'IdempotencyInProgress');
  assert.equal(executions - before, 1);
});

test('a completed key replays the stored response without executing again', { skip }, async () => {
  const key = randomUUID();
  const first = await send('user_a', key, '25');
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  await new Promise((r) => setTimeout(r, 200));
  const before = executions;
  const replay = await send('user_a', key, '25');
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(executions, before);
});

test('reusing a key with a different body is a conflict', { skip }, async () => {
  const key = randomUUID();
  assert.equal((await send('user_a', key, '5')).status, 201);
  await new Promise((r) => setTimeout(r, 200));
  const res = await send('user_a', key, '6');
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'IdempotencyConflict');
});

test('the same key from two different users executes for each', { skip }, async () => {
  const before = executions;
  const key = randomUUID();
  const [a, b] = await Promise.all([send('user_a', key, '7'), send('user_b', key, '7')]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(executions - before, 2);
});

test(
  'a response without a JSON body still completes the key and replays',
  { skip },
  async () => {
    const key = randomUUID();
    const first = await fetch(`${base}/empty`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        cookie: `${cookieName}=${createSessionToken({ userId: 'empty-user', method: 'google' })}`,
      },
      body: JSON.stringify({ amount: '1' }),
    });
    assert.equal(first.status, 204);
    await new Promise((r) => setTimeout(r, 200));
    const second = await fetch(`${base}/empty`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        cookie: `${cookieName}=${createSessionToken({ userId: 'empty-user', method: 'google' })}`,
      },
      body: JSON.stringify({ amount: '1' }),
    });
    assert.equal(second.status, 204);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(emptyExecutions, 1);
  },
);

test('a failed request frees its key at once, unless funds may have moved', { skip }, async () => {
  const post = (key: string, body: unknown) =>
    fetch(`${base}/fails`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        cookie: `${cookieName}=${createSessionToken({ userId: 'fail-user', method: 'google' })}`,
      },
      body: JSON.stringify(body),
    });
  const released = randomUUID();
  await post(released, { status: 503 });
  await new Promise((r) => setTimeout(r, 150));
  const before = failingExecutions;
  const retry = await post(released, { status: 503 });
  assert.equal(retry.headers.get('idempotent-replayed'), null);
  assert.equal(failingExecutions, before + 1);

  const held = randomUUID();
  await post(held, { status: 502, fundsMoved: true });
  await new Promise((r) => setTimeout(r, 150));
  const again = await post(held, { status: 502, fundsMoved: true });
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  assert.equal(failingExecutions, before + 2);
});
