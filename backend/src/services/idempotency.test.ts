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
let cookieName = '';
let closeDb: () => Promise<void> = async () => {};
let createSessionToken: (p: { userId: string; method: 'ops' | 'guest' }) => string = () => '';

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
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  await closeDb();
});

function send(userId: string, key: string, amount: string) {
  const token = createSessionToken({ userId, method: 'ops' });
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
  assert.equal((await loser.json()).error, 'IdempotencyInProgress');
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
  assert.equal((await res.json()).error, 'IdempotencyConflict');
});

test('the same key from two different users executes for each', { skip }, async () => {
  const before = executions;
  const key = randomUUID();
  const [a, b] = await Promise.all([send('user_a', key, '7'), send('user_b', key, '7')]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(executions - before, 2);
});
