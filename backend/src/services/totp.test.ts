import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, generateTotpSecret, matchingStep, totpAt } from './totp.js';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('codes match the RFC 6238 SHA-1 reference vectors', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpAt(RFC_SECRET, Math.floor(2000000000 / 30)), '279037');
});

test('a code is accepted one step either side of now and refused beyond that', () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(matchingStep(RFC_SECRET, totpAt(RFC_SECRET, step), now), step);
  assert.equal(matchingStep(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now), step - 1);
  assert.equal(matchingStep(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now), null);
  assert.equal(matchingStep(RFC_SECRET, 'abcdef', now), null);
});

test('generated secrets are 160-bit base32 that round-trip', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret).length, 20);
});
