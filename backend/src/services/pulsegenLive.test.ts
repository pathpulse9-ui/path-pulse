import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { env } from '../config/env.js';
import { pulseGenEndpointHost, pulseGenLive, pulseGenScoreProvider, resolveScore } from './pulsegen.js';
import { _resetInMemoryForTests } from './scoreStore.js';

/**
 * Live score-feed client (D6). Until now this path had no coverage at all,
 * because exercising it needs an endpoint. These tests stand one up.
 *
 * What is under test is *our client* — request shape, bearer auth, error
 * handling and the fallback to the interim feed. Nothing here says anything
 * about PulseGen itself, which is PathPulse.ai's system and does not exist yet.
 */

let server: Server;
let base: string;
const KEY = 'test-pulsegen-key';

let behaviour: (driverId: string) => { status: number; body: unknown; delayMs?: number } = () => ({
  status: 200,
  body: { score: 0.83, scored_at: '2026-09-18T09:00:00Z' },
});

/** `env` is readonly by design; a test is the one place that legitimately redirects it. */
const feedEnv = env.pulseGen as { baseUrl: string; apiKey: string };
const original = { baseUrl: feedEnv.baseUrl, apiKey: feedEnv.apiKey };

before(async () => {
  _resetInMemoryForTests();
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const match = url.pathname.match(/^\/v1\/drivers\/([^/]+)\/validation-score$/);
    if (!match) {
      res.writeHead(404).end('{}');
      return;
    }
    if ((req.headers.authorization ?? '') !== `Bearer ${KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Unauthorized"}');
      return;
    }
    const out = behaviour(decodeURIComponent(match[1]));
    const send = () => {
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    };
    if (out.delayMs) setTimeout(send, out.delayMs);
    else send();
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  feedEnv.baseUrl = base;
  feedEnv.apiKey = KEY;
});

after(async () => {
  feedEnv.baseUrl = original.baseUrl;
  feedEnv.apiKey = original.apiKey;
  await new Promise<void>((r) => server.close(() => r()));
});

test('the feed reports as live and names the host it points at', () => {
  assert.equal(pulseGenLive(), true);
  assert.equal(pulseGenEndpointHost(), new URL(base).host);
  assert.match(pulseGenEndpointHost() ?? '', /^127\.0\.0\.1:/, 'a local stub is visibly local');
});

test('a live score is fetched and normalised', async () => {
  behaviour = () => ({ status: 200, body: { score: 0.912, scored_at: '2026-09-18T09:00:00Z' } });
  const v = await pulseGenScoreProvider.getScore('drv-live-1');
  assert.equal(v.driverId, 'drv-live-1');
  assert.equal(v.score, 0.912);
  assert.equal(v.scoredAt, '2026-09-18T09:00:00Z');
  assert.equal(v.source, 'pulsegen');
});

test('an out-of-range score is clamped rather than rejected', async () => {
  behaviour = () => ({ status: 200, body: { score: 1.7, scored_at: '2026-09-18T09:00:00Z' } });
  assert.equal((await pulseGenScoreProvider.getScore('d')).score, 1);
  behaviour = () => ({ status: 200, body: { score: -3, scored_at: '2026-09-18T09:00:00Z' } });
  assert.equal((await pulseGenScoreProvider.getScore('d')).score, 0);
});

test('a bad bearer token is refused by the endpoint', async () => {
  feedEnv.apiKey = 'wrong-key';
  await assert.rejects(() => pulseGenScoreProvider.getScore('d'), /returned 401/);
  feedEnv.apiKey = KEY;
});

test('a driver-id with characters needing encoding still resolves', async () => {
  let seen = '';
  behaviour = (driverId) => {
    seen = driverId;
    return { status: 200, body: { score: 0.5, scored_at: '2026-09-18T09:00:00Z' } };
  };
  await pulseGenScoreProvider.getScore('drv/with slash');
  assert.equal(seen, 'drv/with slash');
});

test('a malformed body is an error, not a silent zero', async () => {
  behaviour = () => ({ status: 200, body: { scored_at: '2026-09-18T09:00:00Z' } });
  await assert.rejects(() => pulseGenScoreProvider.getScore('d'), /no score for driver/);
});

test('an upstream failure falls through to the interim rather than stranding a settlement', async () => {
  behaviour = () => ({ status: 503, body: { error: 'ServiceUnavailable' } });
  const v = await resolveScore('drv-fallback-1');
  assert.equal(v.source, 'synthetic', 'a PulseGen outage must not fail the score lookup');
  assert.ok(v.score >= 0 && v.score <= 1);
});

test('an unknown driver falls through rather than erroring', async () => {
  behaviour = () => ({ status: 404, body: { error: 'NotFound' } });
  const v = await resolveScore('drv-unknown-1');
  assert.equal(v.source, 'synthetic');
});
