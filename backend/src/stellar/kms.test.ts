import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as nodeSign, createPublicKey, type KeyObject } from 'node:crypto';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { AwsKmsSigner, addressFromSpki, type KmsSignClient } from './kms.js';

interface FakeKey {
  privateKey: KeyObject;
  spki: Buffer;
}

function makeKey(): FakeKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = createPublicKey(publicKey.export({ type: 'spki', format: 'pem' }) as string).export({
    type: 'spki',
    format: 'der',
  }) as Buffer;
  return { privateKey, spki };
}

function fakeKms(keys: Record<string, FakeKey>, calls: string[] = []): KmsSignClient {
  return {
    async getPublicKey(keyId) {
      calls.push(`getPublicKey:${keyId}`);
      const k = keys[keyId];
      if (!k) throw new Error(`no such key ${keyId}`);
      return k.spki;
    },
    async sign(keyId, message) {
      calls.push(`sign:${keyId}:${message.length}`);
      const k = keys[keyId];
      if (!k) throw new Error(`no such key ${keyId}`);
      return nodeSign(null, message, k.privateKey);
    },
  };
}

function buildTx(source: string): Transaction {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(60)
    .build();
}

function signatureBytes(tx: Transaction): Buffer {
  const parsed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as Transaction;
  return Buffer.from(parsed.signatures[0].signature());
}

test('derives a Stellar address from an Ed25519 SPKI key', () => {
  const { spki } = makeKey();
  const address = addressFromSpki(spki);
  assert.equal(spki.length, 44);
  assert.ok(StrKey.isValidEd25519PublicKey(address));
  assert.deepEqual(StrKey.decodeEd25519PublicKey(address), spki.subarray(12));
});

test('rejects a key that is not Ed25519 SPKI', () => {
  assert.throws(() => addressFromSpki(Buffer.alloc(91)), /ECC_NIST_EDWARDS25519/);
});

test('signer exposes the address derived from the KMS key', async () => {
  const key = makeKey();
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: key }));
  assert.equal(signer.publicKey, addressFromSpki(key.spki));
});

test('produces a signature Stellar verifies against the KMS address', async () => {
  const key = makeKey();
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: key }));
  const tx = buildTx(signer.publicKey);
  const hash = tx.hash();
  await signer.sign(tx);

  assert.equal(tx.signatures.length, 1);
  assert.ok(Keypair.fromPublicKey(signer.publicKey).verify(hash, signatureBytes(tx)));
});

test('signs the 32-byte transaction hash, not the envelope', async () => {
  const calls: string[] = [];
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: makeKey() }, calls));
  await signer.sign(buildTx(signer.publicKey));
  assert.ok(calls.includes('sign:k1:32'));
});

test('fetches the public key once, at construction', async () => {
  const calls: string[] = [];
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: makeKey() }, calls));
  await signer.sign(buildTx(signer.publicKey));
  await signer.sign(buildTx(signer.publicKey));
  assert.equal(calls.filter((c) => c.startsWith('getPublicKey')).length, 1);
});

test('a signature from a different KMS key is rejected', async () => {
  const [a, b] = [makeKey(), makeKey()];
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: a }));
  const tx = buildTx(signer.publicKey);
  const wrong = nodeSign(null, tx.hash(), b.privateKey).toString('base64');
  assert.throws(() => tx.addSignature(signer.publicKey, wrong), /Invalid signature/);
  assert.equal(tx.signatures.length, 0);
});

test('signature survives an XDR round-trip', async () => {
  const signer = await AwsKmsSigner.create('k1', fakeKms({ k1: makeKey() }));
  const tx = buildTx(signer.publicKey);
  await signer.sign(tx);
  const parsed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as Transaction;
  assert.equal(parsed.signatures.length, 1);
  assert.deepEqual(parsed.hash(), tx.hash());
});

test('requires a key id', async () => {
  await assert.rejects(() => AwsKmsSigner.create('', fakeKms({})), /KMS_KEY_ID is not set/);
});
