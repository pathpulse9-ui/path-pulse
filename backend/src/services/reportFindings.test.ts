import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retainedTier, scoreToTier, SCORE_MAX_AGE_MS } from '../stellar/scout.js';
import { INTERNAL_SCORE_CAP, computeInternalScore } from './pathpulseInternalScore.js';
import { scrubEvent } from '../observability/sentry.js';
import { validateScoreBatch } from './pulsegen.js';
import { env } from '../config/env.js';
import { closeDb } from '../db/client.js';

const NOW = Date.parse('2026-10-20T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

test('the internal score alone can never reach a paid SCOUT tier', async () => {
  assert.equal(scoreToTier(INTERNAL_SCORE_CAP), 1);
  if (!env.databaseUrl) return;
  try {
    const breakdown = await computeInternalScore(`drv_${Date.now()}`);
    assert.deepEqual(Object.keys(breakdown).sort(), ['accountAgeDays', 'bankVerified', 'kycVerified', 'payoutSuccess', 'total']);
    assert.ok(breakdown.total <= INTERNAL_SCORE_CAP);
  } finally {
    await closeDb();
  }
});

test('a held badge survives small score dips but drops when it falls below the keep line', () => {
  assert.equal(retainedTier(3, 0.76, daysAgo(1), NOW), 3);
  assert.equal(retainedTier(3, 0.6, daysAgo(1), NOW), 2);
  assert.equal(retainedTier(3, 0.3, daysAgo(1), NOW), 1);
  assert.equal(retainedTier(2, 0.46, daysAgo(1), NOW), 2);
  assert.equal(retainedTier(2, 0.44, daysAgo(1), NOW), 1);
});

test('a missing, unreadable or stale score counts as tier 1', () => {
  assert.equal(retainedTier(3, undefined, daysAgo(1), NOW), 1);
  assert.equal(retainedTier(3, 0.9, undefined, NOW), 1);
  assert.equal(retainedTier(3, 0.9, 'not-a-date', NOW), 1);
  assert.equal(retainedTier(3, 0.9, new Date(NOW - SCORE_MAX_AGE_MS - 1000).toISOString(), NOW), 1);
  assert.equal(retainedTier(3, 0.9, daysAgo(59), NOW), 3);
});

test('Sentry events lose request bodies, cookies, query strings, secret headers and the user IP', () => {
  const event = scrubEvent({
    request: {
      data: { pan: 'ABCDE1234F', aadhaar: '1234' },
      cookies: { pp_session: 'x' },
      query_string: 'token=x',
      headers: { cookie: 'x', authorization: 'Bearer x', 'x-api-key': 'k', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'ua' },
    },
    user: { id: 'u1', ip_address: '1.2.3.4' },
  });
  assert.equal(event.request?.data, undefined);
  assert.equal(event.request?.cookies, undefined);
  assert.equal(event.request?.query_string, undefined);
  assert.deepEqual(event.request?.headers, { 'user-agent': 'ua' });
  assert.deepEqual(event.user, { id: 'u1' });
});

test('score imports refuse a scoredAt more than 30 seconds ahead', () => {
  const ahead = (ms: number) => [{ driverId: 'drv_1', score: 0.5, scoredAt: new Date(Date.now() + ms).toISOString() }];
  assert.doesNotThrow(() => validateScoreBatch(ahead(10_000)));
  assert.throws(() => validateScoreBatch(ahead(60_000)), /in the future/);
  assert.throws(() => validateScoreBatch(ahead(4 * 60_000)), /in the future/);
});
