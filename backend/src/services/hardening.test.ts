import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FAILURES_PER_IDENTITY, LOCKOUT_WINDOW_MS, _resetLoginGuardForTests, isLockedOut, recordFailure } from './loginGuard.js';
import { assertPayoutRecipient } from './sdp.js';
import { reserveUsage, CARRET_DAILY_LIMIT_INR } from './carretLimits.js';
import { numEnv } from '../config/env.js';
import { assertMemoryFallbackAllowed } from '../util/memoryFallback.js';

const VALID_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

test('a failing identity does not lock out other identities', () => {
  _resetLoginGuardForTests();
  for (let i = 0; i < 200; i += 1) recordFailure('partner', `attacker-${i}`);
  assert.equal(isLockedOut('partner', 'legitimate-user'), false);
});

test('repeated lockouts back off exponentially', () => {
  _resetLoginGuardForTests();
  const t = 1_000_000;
  for (let i = 0; i < MAX_FAILURES_PER_IDENTITY; i += 1) recordFailure('ops', 'a', t);
  assert.equal(isLockedOut('ops', 'a', t + LOCKOUT_WINDOW_MS - 1), true);
  assert.equal(isLockedOut('ops', 'a', t + LOCKOUT_WINDOW_MS + 1), false);
  const t2 = t + LOCKOUT_WINDOW_MS + 2;
  for (let i = 0; i < MAX_FAILURES_PER_IDENTITY; i += 1) recordFailure('ops', 'a', t2);
  assert.equal(isLockedOut('ops', 'a', t2 + LOCKOUT_WINDOW_MS + 1), true);
  assert.equal(isLockedOut('ops', 'a', t2 + 2 * LOCKOUT_WINDOW_MS + 1), false);
});

test('payout recipients reject formula and delimiter injection', () => {
  assert.doesNotThrow(() => assertPayoutRecipient('drv-001', VALID_ADDRESS));
  for (const bad of ['=cmd|calc', '+1', '@SUM(A1)', 'a,b', 'a\nb', '"q"', '', '-lead']) {
    assert.throws(() => assertPayoutRecipient(bad, VALID_ADDRESS), /userId/);
  }
  assert.throws(() => assertPayoutRecipient('drv-001', 'not-a-key'), /Stellar/);
});

test('the daily Carret limit holds under concurrent reservations', async () => {
  if (process.env.DATABASE_URL) await (await import('../db/client.js')).migrate();
  const account = `acct-${Date.now()}`;
  const chunk = CARRET_DAILY_LIMIT_INR / 3 + 1;
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => reserveUsage(account, 'withdraw_inr', chunk)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  await assert.rejects(reserveUsage(account, 'withdraw_inr', Number.NaN), /positive finite/);
  await assert.rejects(reserveUsage(account, 'withdraw_inr', Number.POSITIVE_INFINITY), /positive finite/);
});

test('numeric env settings must be finite', () => {
  process.env.PP_TEST_NUM = 'abc';
  assert.throws(() => numEnv('PP_TEST_NUM', 5), /PP_TEST_NUM/);
  process.env.PP_TEST_NUM = '-1';
  assert.throws(() => numEnv('PP_TEST_NUM', 5), /PP_TEST_NUM/);
  process.env.PP_TEST_NUM = '7';
  assert.equal(numEnv('PP_TEST_NUM', 5), 7);
  delete process.env.PP_TEST_NUM;
  assert.equal(numEnv('PP_TEST_NUM', 5), 5);
});

test('in-memory store fallbacks are refused on mainnet', () => {
  assert.throws(() => assertMemoryFallbackAllowed('settlement store', 'mainnet'), /requires the database on mainnet/);
  assert.doesNotThrow(() => assertMemoryFallbackAllowed('settlement store', 'testnet'));
});
