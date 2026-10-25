import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { assertDepositMemo, senderAllowlist, matchDeposit, type DepositOperation } from './deposits.js';

const source = Keypair.random().publicKey();
const ministry = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();
const usdc = { code: 'USDC', issuer };

const pay = (over: Partial<DepositOperation>): DepositOperation => ({
  type: 'payment',
  from: ministry,
  to: source,
  amount: '100.0000000',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: issuer,
  ...over,
});

test('a payment of the settled asset into the source funds the batch', () => {
  assert.deepEqual(matchDeposit([pay({})], source, usdc, '100'), { from: ministry, amount: '100.0000000' });
});

test('path payments and several payments in one transaction add up', () => {
  const ops = [pay({ amount: '60' }), pay({ type: 'path_payment_strict_receive', amount: '40' })];
  assert.equal(matchDeposit(ops, source, usdc, '100').amount, '100.0000000');
});

test('payments elsewhere, in another asset, or of another kind do not count', () => {
  const ops = [
    pay({ to: Keypair.random().publicKey() }),
    pay({ asset_issuer: Keypair.random().publicKey() }),
    pay({ type: 'create_account' }),
  ];
  assert.throws(() => matchDeposit(ops, source, usdc, '1'), { name: 'DepositInvalid' });
});

test('a deposit smaller than the gross amount is refused', () => {
  assert.throws(() => matchDeposit([pay({ amount: '99.9999999' })], source, usdc, '100'), {
    name: 'DepositInvalid',
    message: /99\.9999999 USDC is less than the 100/,
  });
});

test('native XLM deposits match only native payments', () => {
  const xlm = pay({ asset_type: 'native', asset_code: undefined, asset_issuer: undefined, amount: '5' });
  assert.equal(matchDeposit([xlm], source, { code: 'XLM' }, '5').amount, '5.0000000');
  assert.throws(() => matchDeposit([pay({ amount: '5' })], source, { code: 'XLM' }, '5'), { name: 'DepositInvalid' });
});

test('on mainnet only payments from the allowed senders count toward the deposit', () => {
  const treasury = 'GTREASURY';
  const ops = [pay({ amount: '60', from: treasury }), pay({ amount: '60' })];
  assert.equal(matchDeposit(ops, source, usdc, '50', [treasury]).amount, '60.0000000');
  assert.throws(() => matchDeposit(ops, source, usdc, '100', [treasury]), { name: 'DepositInvalid' });
  assert.throws(() => matchDeposit([pay({})], source, usdc, '1', [treasury]), /not paid by an authorised sender/);
});

test('the settlement source can never fund its own settlement', () => {
  const allowed = senderAllowlist(['GTREASURY', source, 'GEXTRA', 'GTREASURY', ''], source);
  assert.deepEqual(allowed, ['GTREASURY', 'GEXTRA']);
  assert.throws(() => matchDeposit([pay({ amount: '60', from: source })], source, usdc, '50', allowed), {
    name: 'DepositInvalid',
  });
});

test('a deposit memo must match the one named by the settlement request', () => {
  assert.doesNotThrow(() => assertDepositMemo('stl-2026-10-19-a', 'stl-2026-10-19-a'));
  assert.doesNotThrow(() => assertDepositMemo(undefined, undefined));
  assert.throws(() => assertDepositMemo(undefined, 'stl-2026-10-19-a'), { name: 'DepositInvalid' });
  assert.throws(() => assertDepositMemo('other', 'stl-2026-10-19-a'), /does not match/);
});
