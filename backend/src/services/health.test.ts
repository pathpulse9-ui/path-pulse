import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { env } from '../config/env.js';
import { runChecks, notifyTransitions, type ReadinessReport } from './health.js';
import { sendAlert, formatAlert, recentAlerts, _resetAlertsForTests } from './alerts.js';

const received: string[] = [];
let server: Server;
const alertsEnv = env.alerts as { webhookUrl: string };

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push((JSON.parse(body) as { text: string }).text);
      res.end('ok');
    });
  }).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  alertsEnv.webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

after(async () => {
  alertsEnv.webhookUrl = '';
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  received.length = 0;
  _resetAlertsForTests();
});

const report = (checks: Array<[string, boolean]>): ReadinessReport => ({
  ok: checks.every(([, ok]) => ok),
  network: 'testnet',
  checkedAt: new Date().toISOString(),
  checks: checks.map(([name, ok]) => ({ name, ok, latencyMs: 1, error: ok ? undefined : 'boom' })),
});

test('readiness fails when any check throws or hangs, and reports each one', async () => {
  const r = await runChecks(
    [
      { name: 'fine', run: async () => {} },
      { name: 'broken', run: async () => { throw new Error('refused'); } },
      { name: 'stuck', run: () => new Promise(() => {}) },
    ],
    50,
  );
  assert.equal(r.ok, false);
  const byName = Object.fromEntries(r.checks.map((c) => [c.name, c]));
  assert.equal(byName.fine.ok, true);
  assert.equal(byName.broken.error, 'refused');
  assert.match(byName.stuck.error ?? '', /timed out/);
});

test('a healthy first tick is silent; going down and recovering each alert once', async () => {
  const state = new Map<string, boolean>();
  await notifyTransitions(state, report([['database', true]]));
  assert.equal(received.length, 0);
  await notifyTransitions(state, report([['database', false]]));
  await notifyTransitions(state, report([['database', false]]));
  assert.equal(received.length, 1);
  assert.match(received[0], /database is down/);
  await notifyTransitions(state, report([['database', true]]));
  assert.equal(received.length, 2);
  assert.match(received[1], /database recovered/);
});

test('a failing check on the very first tick still alerts', async () => {
  await notifyTransitions(new Map(), report([['sdp', false]]));
  assert.equal(received.length, 1);
  assert.match(received[0], /sdp is down/);
});

test('repeat alerts inside ten minutes are suppressed', async () => {
  const alert = { key: 'error:X', severity: 'critical' as const, title: 'X failed' };
  assert.equal(await sendAlert(alert, 1_000), 'sent');
  assert.equal(await sendAlert(alert, 2_000), 'deduped');
  assert.equal(await sendAlert(alert, 1_000 + 10 * 60 * 1000 + 1), 'sent');
  assert.equal(received.length, 2);
});

test('alerts name the network so a mainnet page is never mistaken for testnet', () => {
  assert.match(formatAlert({ key: 'k', severity: 'critical', title: 'T' }), /\[PathPulse testnet\] T/);
});

test('the status log records each alert and how it was delivered, newest first, without duplicates', async () => {
  const t0 = Date.parse('2026-10-09T00:00:00Z');
  await sendAlert({ key: 'k', severity: 'critical', title: 'sdp is down' }, t0);
  await sendAlert({ key: 'k', severity: 'critical', title: 'sdp is down' }, t0 + 1000);
  await sendAlert({ key: 'k', severity: 'resolved', title: 'sdp recovered' }, t0 + 2000);
  alertsEnv.webhookUrl = '';
  try {
    await sendAlert({ key: 'other', severity: 'warning', title: 'unwired' }, t0 + 3000);
  } finally {
    alertsEnv.webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  }
  assert.deepEqual(
    recentAlerts().map((a) => [a.title, a.delivery, a.at]),
    [
      ['unwired', 'disabled', '2026-10-09T00:00:03.000Z'],
      ['sdp recovered', 'sent', '2026-10-09T00:00:02.000Z'],
      ['sdp is down', 'sent', '2026-10-09T00:00:00.000Z'],
    ],
  );
});

test('service accounts below their XLM floor are reported', async () => {
  const { xlmShortfalls } = await import('./health.js');
  const floors = new Map([['__reserve_sponsor__', 2], ['__settlement_source__', 1.5]]);
  const short = xlmShortfalls(
    [
      { name: '__reserve_sponsor__', address: 'GSPONSOR', xlm: 1.9 },
      { name: '__settlement_source__', address: 'GSETTLE', xlm: 3 },
    ],
    floors,
  );
  assert.deepEqual(short, ['__reserve_sponsor__ GSPONSOR holds 1.9 XLM, below 2']);
});
