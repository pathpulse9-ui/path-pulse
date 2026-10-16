import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';
import { createBrokerGuard } from './stellarbroker-provider.js';

const trader = Keypair.random().publicKey();
const brokerFeeAccount = Keypair.random().publicKey();
const channel = Keypair.random().publicKey();
const usdc = new Asset('USDC', Keypair.random().publicKey());
const xlm = Asset.native();

const limits = { trader, selling: xlm, buying: usdc, maxSellStroops: 200_000_000n, maxFeeStroops: 10_000_000n };

function tx(ops: xdr.Operation[], source = trader, fee = '100') {
  const b = new TransactionBuilder(new Account(source, '1'), { fee, networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(60).build();
}

const swap = (amount: string, over: Partial<Parameters<typeof Operation.pathPaymentStrictSend>[0]> = {}) =>
  Operation.pathPaymentStrictSend({
    sendAsset: xlm,
    sendAmount: amount,
    destination: trader,
    destAsset: usdc,
    destMin: '0.0000001',
    path: [],
    ...over,
  });

test('a swap from the trader back to the trader in the right assets is approved and its fee bump recorded', () => {
  const guard = createBrokerGuard(limits);
  const inner = guard.approve(tx([swap('10')])) as ReturnType<typeof tx>;
  const bump = TransactionBuilder.buildFeeBumpTransaction(trader, '200', inner, Networks.PUBLIC);
  guard.approve(bump);
  assert.equal(guard.committedSellStroops, 100_000_000n);
  assert.deepEqual(guard.submittedHashes, [bump.hash().toString('hex')]);
});

test('a channel-sourced transaction is fine when every operation is sourced from the trader', () => {
  const guard = createBrokerGuard(limits);
  guard.approve(tx([swap('5', { source: trader })], channel));
  assert.equal(guard.committedSellStroops, 50_000_000n);
});

test('selling more than requested across several transactions is refused', () => {
  const guard = createBrokerGuard(limits);
  guard.approve(tx([swap('15')]));
  assert.throws(() => guard.approve(tx([swap('6')])), { name: 'BrokerTxRefused', message: /more than the 20/ });
  assert.equal(guard.committedSellStroops, 150_000_000n);
});

test('payments, wrong assets, foreign sources and redirected proceeds are refused', () => {
  const guard = createBrokerGuard(limits);
  const cases = [
    tx([Operation.payment({ destination: brokerFeeAccount, asset: xlm, amount: '1' })]),
    tx([swap('1', { sendAsset: usdc, destAsset: xlm })]),
    tx([swap('1', { source: channel })], channel),
    tx([Operation.pathPaymentStrictReceive({ sendAsset: xlm, sendMax: '1', destination: brokerFeeAccount, destAsset: usdc, destAmount: '1', path: [] })]),
  ];
  for (const t of cases) assert.throws(() => guard.approve(t), { name: 'BrokerTxRefused' });
  assert.equal(guard.committedSellStroops, 0n);
});

test('a strict-send fee to the broker counts toward the sell cap', () => {
  const guard = createBrokerGuard(limits);
  guard.approve(tx([swap('19'), swap('1', { destination: brokerFeeAccount, destAsset: xlm })]));
  assert.equal(guard.committedSellStroops, 200_000_000n);
  assert.throws(() => guard.approve(tx([swap('0.0000001')])), { name: 'BrokerTxRefused' });
});

test('fee bumps must wrap an approved transaction, be paid by the trader, and stay under the fee cap', () => {
  const guard = createBrokerGuard(limits);
  const unapproved = tx([swap('1')]);
  assert.throws(() => guard.approve(TransactionBuilder.buildFeeBumpTransaction(trader, '200', unapproved, Networks.PUBLIC)), /unapproved/);
  const inner = guard.approve(tx([swap('1')])) as ReturnType<typeof tx>;
  assert.throws(
    () => guard.approve(TransactionBuilder.buildFeeBumpTransaction(Keypair.random().publicKey(), '200', inner, Networks.PUBLIC)),
    /not paid by the trading account/,
  );
  assert.throws(() => guard.approve(TransactionBuilder.buildFeeBumpTransaction(trader, '6000000', inner, Networks.PUBLIC)), /network fees/);
});

test('raw Soroban authorization payloads are never signed', () => {
  const guard = createBrokerGuard(limits);
  assert.throws(() => guard.approve(Buffer.alloc(32)), /raw authorization payloads/);
});
