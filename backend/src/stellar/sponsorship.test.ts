import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { buildSponsoredAccountTx, buildSponsoredFeeBump, buildSponsoredTrustlineTx } from './sponsorship.js';

const sponsor = Keypair.random().publicKey();
const driver = Keypair.random().publicKey();
const usdc = new Asset('USDC', Keypair.random().publicKey());

test('a sponsored account is created with zero XLM and its trustlines inside one sponsorship', () => {
  const tx = buildSponsoredAccountTx(new Account(sponsor, '10'), driver, [usdc]);
  assert.equal(tx.source, sponsor);
  assert.deepEqual(
    tx.operations.map((op) => op.type),
    ['beginSponsoringFutureReserves', 'createAccount', 'changeTrust', 'endSponsoringFutureReserves'],
  );
  const [begin, create, trust, end] = tx.operations as unknown as Array<Record<string, unknown>>;
  assert.equal(begin.sponsoredId, driver);
  assert.equal(begin.source, undefined);
  assert.equal(create.destination, driver);
  assert.equal(create.startingBalance, '0.0000000');
  assert.equal(trust.source, driver);
  assert.equal((trust.line as Asset).getCode(), 'USDC');
  assert.equal(end.source, driver);
});

test('a sponsored trustline is paid for by the sponsor, not the driver', () => {
  const tx = buildSponsoredTrustlineTx(new Account(sponsor, '10'), driver, usdc);
  assert.equal(tx.source, sponsor);
  assert.deepEqual(
    tx.operations.map((op) => [op.type, (op as { source?: string }).source]),
    [
      ['beginSponsoringFutureReserves', undefined],
      ['changeTrust', driver],
      ['endSponsoringFutureReserves', driver],
    ],
  );
});

test('a driver transaction is fee-bumped so the sponsor pays and the driver signature is kept', () => {
  const driverKey = Keypair.random();
  const inner = new TransactionBuilder(new Account(driverKey.publicKey(), '7'), {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: usdc, limit: '0' }))
    .setTimeout(60)
    .build();
  inner.sign(driverKey);
  const bump = buildSponsoredFeeBump(sponsor, inner);
  assert.equal(bump.feeSource, sponsor);
  assert.equal(bump.innerTransaction.source, driverKey.publicKey());
  assert.equal(bump.innerTransaction.signatures.length, 1);
  assert.equal(bump.innerTransaction.hash().toString('hex'), inner.hash().toString('hex'));
  assert.ok(Number(bump.fee) >= 2 * Number(BASE_FEE));
});
