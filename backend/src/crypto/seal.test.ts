import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { generateKey, keyFromEnv, seal, unseal } from './seal.js';

const key = keyFromEnv(generateKey());

test('round-trips a Stellar secret seed', () => {
  const seed = Keypair.random().secret();
  assert.equal(unseal(seal(seed, key), key), seed);
});

test('ciphertext does not contain the plaintext', () => {
  const seed = Keypair.random().secret();
  assert.ok(!seal(seed, key).includes(seed));
});

test('same plaintext seals to different ciphertexts', () => {
  const seed = Keypair.random().secret();
  assert.notEqual(seal(seed, key), seal(seed, key));
});

test('a different key cannot unseal', () => {
  const sealed = seal(Keypair.random().secret(), key);
  assert.throws(() => unseal(sealed, keyFromEnv(generateKey())));
});

test('tampered ciphertext is rejected', () => {
  const sealed = seal(Keypair.random().secret(), key);
  const raw = Buffer.from(sealed.slice(sealed.indexOf('.') + 1), 'base64');
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => unseal(`v1.${raw.toString('base64')}`, key));
});

test('tampered auth tag is rejected', () => {
  const sealed = seal(Keypair.random().secret(), key);
  const raw = Buffer.from(sealed.slice(sealed.indexOf('.') + 1), 'base64');
  raw[12] ^= 0xff;
  assert.throws(() => unseal(`v1.${raw.toString('base64')}`, key));
});

test('unsupported version is rejected', () => {
  const sealed = seal(Keypair.random().secret(), key);
  assert.throws(() => unseal(sealed.replace('v1.', 'v2.'), key), /unsupported version/);
});

test('truncated payload is rejected', () => {
  assert.throws(() => unseal(`v1.${randomBytes(8).toString('base64')}`, key), /truncated/);
});

test('rejects a key that is not 32 bytes', () => {
  assert.throws(() => keyFromEnv(randomBytes(16).toString('base64')), /must be 32 bytes/);
});
