import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRewardPayout } from './payoutHistory.js';

const ME = 'GDRIVER';

const base = {
  id: '1',
  paging_token: 'pt1',
  created_at: '2026-10-05T10:00:00Z',
  transaction_hash: 'abc123',
};

test('an incoming USDC payment becomes a reward payout', () => {
  const p = toRewardPayout(ME, {
    ...base,
    type: 'payment',
    from: 'GPOOL',
    to: ME,
    amount: '1.5000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: 'GISSUER',
  });
  assert.deepEqual(p?.asset, { code: 'USDC', issuer: 'GISSUER' });
  assert.equal(p?.amount, '1.5000000');
  assert.equal(p?.from, 'GPOOL');
  assert.equal(p?.cursor, 'pt1');
  assert.match(p?.explorerUrl ?? '', /\/tx\/abc123$/);
});

test('an outgoing payment is not a reward', () => {
  const p = toRewardPayout(ME, { ...base, type: 'payment', from: ME, to: 'GOTHER', amount: '2', asset_type: 'native' });
  assert.equal(p, null);
});

test('a native path payment received counts, priced in XLM', () => {
  const p = toRewardPayout(ME, {
    ...base,
    type: 'path_payment_strict_send',
    from: 'GSWAP',
    to: ME,
    amount: '10',
    asset_type: 'native',
  });
  assert.deepEqual(p?.asset, { code: 'XLM' });
});

test('the account creation that funded the wallet is listed as its first XLM', () => {
  const p = toRewardPayout(ME, {
    ...base,
    type: 'create_account',
    account: ME,
    funder: 'GFRIENDBOT',
    starting_balance: '10000.0000000',
  });
  assert.equal(p?.amount, '10000.0000000');
  assert.equal(p?.from, 'GFRIENDBOT');
});

test('creating someone else’s account is not a reward', () => {
  const p = toRewardPayout(ME, { ...base, type: 'create_account', account: 'GOTHER', funder: ME, starting_balance: '1' });
  assert.equal(p, null);
});
