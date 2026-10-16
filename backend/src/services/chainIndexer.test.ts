import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIndexedPayment, unexplainedOutflows, type HorizonPaymentRecord } from './chainIndexer.js';

const watched = { role: 'settlement_source', address: 'GSOURCE' };
const base: HorizonPaymentRecord = {
  id: '1',
  paging_token: '1',
  type: 'payment',
  transaction_hash: 'tx1',
  created_at: '2026-10-12T00:00:00Z',
  from: 'GSOURCE',
  to: 'GPOOL',
  amount: '3.0000000',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: 'GISSUER',
};

test('a payment record is indexed with its asset and direction fields', () => {
  const p = toIndexedPayment(base, watched)!;
  assert.equal(p.assetCode, 'USDC');
  assert.equal(p.from, 'GSOURCE');
  assert.equal(p.amount, '3.0000000');
});

test('account creation is indexed as an XLM movement from the funder', () => {
  const p = toIndexedPayment(
    { ...base, type: 'create_account', funder: 'GFUNDER', account: 'GNEW', starting_balance: '5', asset_type: undefined },
    watched,
  )!;
  assert.deepEqual([p.from, p.to, p.assetCode, p.amount], ['GFUNDER', 'GNEW', 'XLM', '5']);
});

test('non-payment operations and failed transactions are skipped', () => {
  assert.equal(toIndexedPayment({ ...base, type: 'set_options' }, watched), null);
  assert.equal(toIndexedPayment({ ...base, transaction_successful: false }, watched), null);
});

test('outflows from the settlement source outside a known settlement are flagged', () => {
  const a = toIndexedPayment(base, watched)!;
  const b = toIndexedPayment({ ...base, id: '2', transaction_hash: 'tx2' }, watched)!;
  const inbound = toIndexedPayment({ ...base, id: '3', transaction_hash: 'tx3', from: 'GTREASURY', to: 'GSOURCE' }, watched)!;
  const self = toIndexedPayment({ ...base, id: '4', transaction_hash: 'tx4', to: 'GSOURCE' }, watched)!;
  const now = Date.parse(base.created_at) + 1000;
  assert.deepEqual(
    unexplainedOutflows([a, b, inbound, self], 'GSOURCE', new Set(['tx1']), now).map((p) => p.txHash),
    ['tx2'],
  );
});

test('historical outflows found during a backfill do not alert', () => {
  const old = toIndexedPayment({ ...base, transaction_hash: 'tx9' }, watched)!;
  assert.deepEqual(unexplainedOutflows([old], 'GSOURCE', new Set(), Date.parse(base.created_at) + 2 * 86_400_000), []);
});
