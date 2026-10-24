import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';
import { createBrokerGuard, spendableStroops } from './stellarbroker-provider.js';

const trader = Keypair.random().publicKey();
const brokerFeeAccount = Keypair.random().publicKey();
const channel = Keypair.random().publicKey();
const usdc = new Asset('USDC', Keypair.random().publicKey());
const xlm = Asset.native();

const limits = {
  trader,
  selling: xlm,
  buying: usdc,
  maxSellStroops: 200_000_000n,
  minBuyStroops: 20_000_000n,
  maxFeeStroops: 10_000_000n,
};

function tx(ops: xdr.Operation[], source = trader, fee = '100', timeout = 60) {
  const b = new TransactionBuilder(new Account(source, '1'), { fee, networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  return b.setTimeout(timeout).build();
}

const swap = (amount: string, over: Partial<Parameters<typeof Operation.pathPaymentStrictSend>[0]> = {}) =>
  Operation.pathPaymentStrictSend({
    sendAsset: xlm,
    sendAmount: amount,
    destination: trader,
    destAsset: usdc,
    destMin: (Number(amount) / 10).toFixed(7),
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

test('a fee leg paying the broker is refused: every leg must pay the trading account', () => {
  const guard = createBrokerGuard(limits);
  assert.throws(
    () => guard.approve(tx([swap('19'), swap('1', { destination: brokerFeeAccount, destAsset: xlm })])),
    { name: 'BrokerTxRefused', message: /other than the trading account/ },
  );
  assert.equal(guard.committedSellStroops, 0n);
});

test('a leg below the quoted minimum rate is refused', () => {
  const guard = createBrokerGuard(limits);
  assert.throws(() => guard.approve(tx([swap('10', { destMin: '0.9999999' })])), {
    name: 'BrokerTxRefused',
    message: /less than the quoted minimum/,
  });
  const strictReceive = Operation.pathPaymentStrictReceive({
    sendAsset: xlm,
    sendMax: '10',
    destination: trader,
    destAsset: usdc,
    destAmount: '0.5',
    path: [],
  });
  assert.throws(() => guard.approve(tx([strictReceive])), /less than the quoted minimum/);
  guard.approve(tx([swap('10', { destMin: '1' })]));
  assert.equal(guard.committedSellStroops, 100_000_000n);
});

test('transactions without an expiry or valid for more than 60 seconds are refused', () => {
  const guard = createBrokerGuard(limits);
  assert.throws(() => guard.approve(tx([swap('1')], trader, '100', 0)), /no expiry/);
  assert.throws(() => guard.approve(tx([swap('1')], trader, '100', 600)), /longer than 60s/);
  assert.equal(guard.committedSellStroops, 0n);
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

test('the converted amount is what the chain delivered to the trader, not what the broker reports', async () => {
  const { sumDelivered } = await import('./stellarbroker-provider.js');
  const issuer = usdc.getIssuer();
  const ops = [
    { type: 'path_payment_strict_send', to: trader, amount: '3.5000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer },
    { type: 'path_payment_strict_receive', to: trader, amount: '1.2500000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer },
    { type: 'path_payment_strict_send', to: brokerFeeAccount, amount: '9.0000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer },
    { type: 'payment', to: trader, amount: '100.0000000', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer },
    { type: 'path_payment_strict_send', to: trader, amount: '7.0000000', asset_type: 'native' },
  ];
  assert.equal(sumDelivered(ops, trader, usdc), 47_500_000n);
});

test('an Aquarius amount that is not a whole stroop count is refused', async () => {
  const { parseStroopAmount } = await import('./aquarius.js');
  assert.equal(parseStroopAmount('12345'), 12345n);
  for (const bad of ['-1', '1.5', '1e30', '', 'NaN', '9'.repeat(40)]) {
    assert.throws(() => parseStroopAmount(bad), { name: 'RoutingUnavailable' });
  }
});

test('spendable XLM excludes the minimum balance of sponsored entries and open offers', () => {
  const account = {
    balances: [{ asset_type: 'native', balance: '12.4723882', selling_liabilities: '0.5000000' }],
    subentry_count: 2,
    num_sponsoring: 17,
    num_sponsored: 0,
  };
  assert.equal(spendableStroops(account, xlm), 14_723_882n);
});

test('spendable USDC is the line balance minus liabilities, and zero without a trustline', () => {
  const account = {
    balances: [
      { asset_type: 'native', balance: '20.0000000' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: usdc.getIssuer(), balance: '0.3586489' },
    ],
    subentry_count: 1,
  };
  assert.equal(spendableStroops(account, usdc), 3_586_489n);
  assert.equal(spendableStroops(account, new Asset('USDC', Keypair.random().publicKey())), 0n);
});
