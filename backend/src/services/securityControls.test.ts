import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SettlementBatch } from '@pathpulse/contract';
import { roleOf, withRole } from './session.js';
import {
  MAX_FAILURES_PER_IDENTITY,
  _resetLoginGuardForTests,
  clearFailures,
  isLockedOut,
  recordFailure,
} from './loginGuard.js';
import { checkWithdrawalEntitlement } from './offramp.js';
import { batchesToCsv } from './settlementExport.js';
import { _resetSponsorBudgetForTests, chargeSponsor } from '../stellar/sponsorship.js';
import { env } from '../config/env.js';

test('an ops role expires after its TTL', () => {
  const now = 1_000_000;
  const elevated = withRole({ userId: 'u', method: 'google' }, 'ops', now);
  assert.equal(roleOf(elevated, now + 1000), 'ops');
  assert.equal(roleOf(elevated, now + env.session.opsRoleTtlSeconds * 1000), undefined);
});

test('an ops role without an expiry is never honoured', () => {
  assert.equal(roleOf({ userId: 'u', method: 'google', role: 'ops' }), undefined);
});

test('passcode attempts lock out an identity after repeated failures', () => {
  _resetLoginGuardForTests();
  for (let i = 0; i < MAX_FAILURES_PER_IDENTITY; i += 1) {
    assert.equal(isLockedOut('ops', 'a@x.com'), false);
    recordFailure('ops', 'a@x.com');
  }
  assert.equal(isLockedOut('ops', 'a@x.com'), true);
  assert.equal(isLockedOut('ops', 'b@x.com'), false);
  clearFailures('ops', 'a@x.com');
  assert.equal(isLockedOut('ops', 'a@x.com'), false);
});

test('lockouts lapse after the window', () => {
  _resetLoginGuardForTests();
  const t = 5_000_000;
  for (let i = 0; i < MAX_FAILURES_PER_IDENTITY; i += 1) recordFailure('ops', 'c@x.com', t);
  assert.equal(isLockedOut('ops', 'c@x.com', t + 1), true);
  assert.equal(isLockedOut('ops', 'c@x.com', t + 15 * 60 * 1000 + 1), false);
});

test('a withdrawal must draw on a batch that paid this account', () => {
  const payouts = [{ userId: 'driver', amount: '5.0000000' }];
  assert.throws(() => checkWithdrawalEntitlement('stranger', 'b1', '1', payouts, []), { name: 'NotEntitled' });
  assert.doesNotThrow(() => checkWithdrawalEntitlement('driver', 'b1', '5', payouts, []));
});

test('withdrawals against one batch cannot exceed the payout', () => {
  const payouts = [{ userId: 'driver', amount: '5.0000000' }];
  const prior = [
    { settlementBatchId: 'b1', status: 'completed', amount: '3' },
    { settlementBatchId: 'b1', status: 'error', amount: '4' },
    { settlementBatchId: 'b2', status: 'completed', amount: '4' },
  ];
  assert.doesNotThrow(() => checkWithdrawalEntitlement('driver', 'b1', '2', payouts, prior));
  assert.throws(() => checkWithdrawalEntitlement('driver', 'b1', '2.0000001', payouts, prior), {
    name: 'ExceedsEntitlement',
  });
});

test('CSV exports neutralise spreadsheet formulas but keep negative numbers', () => {
  const batch = {
    id: '=HYPERLINK("http://evil")',
    createdAt: '2026-10-12T00:00:00.000Z',
    network: 'testnet',
    asset: { code: '@SUM(A1)' },
    grossAmount: '-1.5',
    split: { authorities: '+1', driverRewards: '0', treasury: '0' },
    driverPayouts: [],
    txHash: 'h',
  } as unknown as SettlementBatch;
  const row = batchesToCsv([batch]).split('\n')[1];
  assert.ok(row.startsWith(`"'=HYPERLINK(""http://evil"")"`), row);
  assert.match(row, /,'@SUM\(A1\),-1\.5,'\+1,/);
});

test('the sponsor budget refuses fee bumps beyond the hourly cap', () => {
  _resetSponsorBudgetForTests();
  const now = 9_000_000;
  for (let i = 0; i < env.sponsor.maxFeeBumpsPerHour; i += 1) chargeSponsor('feeBump', now);
  assert.throws(() => chargeSponsor('feeBump', now), { name: 'SponsorBudgetExhausted' });
  assert.doesNotThrow(() => chargeSponsor('feeBump', now + 60 * 60 * 1000 + 1));
  _resetSponsorBudgetForTests();
});
