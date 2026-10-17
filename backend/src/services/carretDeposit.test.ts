import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, Keypair } from '@stellar/stellar-sdk';
import { buildCarretDepositTx } from './carretDeposit.js';

const driver = Keypair.random().publicKey();
const carret = Keypair.random().publicKey();
const usdc = new Asset('USDC', Keypair.random().publicKey());

test('a deposit pays Carret the exact amount in USDC with a numeric memo as a memo id', () => {
  const tx = buildCarretDepositTx(new Account(driver, '5'), carret, '3141592653', usdc, '12.50');
  assert.equal(tx.source, driver);
  assert.equal(tx.memo.type, 'id');
  assert.equal(tx.memo.value, '3141592653');
  const [op] = tx.operations as unknown as Array<Record<string, unknown>>;
  assert.equal(op.type, 'payment');
  assert.equal(op.destination, carret);
  assert.equal(op.amount, '12.5000000');
  assert.ok((op.asset as Asset).equals(usdc));
});

test('a non-numeric memo label is sent as a text memo', () => {
  const tx = buildCarretDepositTx(new Account(driver, '5'), carret, 'PP-ACCT-7', usdc, '1');
  assert.equal(tx.memo.type, 'text');
  assert.equal(String(tx.memo.value), 'PP-ACCT-7');
});

test('a deposit without a memo is refused, since Carret could not attribute it', () => {
  assert.throws(() => buildCarretDepositTx(new Account(driver, '5'), carret, null, usdc, '1'), {
    name: 'CarretDepositUnavailable',
  });
});
