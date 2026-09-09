import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { createServer } from '../server.js';
import { migrate, db, closeDb } from '../db/client.js';
import { createSessionToken, verifySessionToken } from '../services/session.js';
import { buildChallenge, verifyChallenge } from '../services/walletAuth.js';
import { verifyRampWebhook } from '../services/ramp.js';
import { verifyCarretWebhook } from '../services/carret.js';

let server: Server;
let base: string;
const walletAddresses: string[] = [];

before(async () => {
  await migrate();
  server = createServer().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (walletAddresses.length) {
    await db().query('delete from wallet_users where address = any($1)', [walletAddresses]);
  }
  await new Promise<void>((r) => server.close(() => r()));
  await closeDb();
});

test('a valid session token round-trips', () => {
  const token = createSessionToken({ userId: 'u1', method: 'guest' });
  assert.equal(verifySessionToken(token)?.userId, 'u1');
});

test('a token signed with the wrong secret is rejected', () => {
  const forged = jwt.sign({ userId: 'attacker', method: 'wallet' }, 'not-the-session-secret');
  assert.equal(verifySessionToken(forged), null);
});

test('a tampered token is rejected', () => {
  const token = createSessionToken({ userId: 'u1', method: 'guest' });
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ userId: 'root', method: 'guest' })).toString('base64url');
  assert.equal(verifySessionToken(parts.join('.')), null);
});

test('garbage is rejected rather than throwing', () => {
  assert.equal(verifySessionToken('not-a-jwt'), null);
});

test('the session cookie is HttpOnly, lax and dev-insecure', async () => {
  const res = await fetch(base + '/v1/auth/guest', { method: 'POST' });
  const cookie = res.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i);
});

test('a forged session cookie does not unlock the delegated signer', async () => {
  const forged = jwt.sign({ userId: 'victim', method: 'google' }, 'wrong-secret');
  const res = await fetch(base + '/v1/tx/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `pathpulse_session=${forged}` },
    body: JSON.stringify({ operations: [{ type: 'changeTrust', asset: { code: 'USDC' } }] }),
  });
  assert.equal(res.status, 401);
});

test('the Ramp webhook verifier fails closed', () => {
  assert.equal(verifyRampWebhook('', ''), false);
  assert.equal(verifyRampWebhook('{"type":"RELEASED"}', 'ZmFrZQ=='), false);
});

test('the Carret webhook verifier fails closed without a configured secret', () => {
  const body = '{"order_id":"1","status":"filled"}';
  const sig = createHmac('sha256', 'guessed-secret').update(body).digest('hex');
  assert.equal(verifyCarretWebhook(body, sig), false);
  assert.equal(verifyCarretWebhook(body, ''), false);
});

test('SEP-10: a challenge signed by the account verifies and yields a wallet user', async () => {
  const kp = Keypair.random();
  walletAddresses.push(kp.publicKey());
  const { transaction, networkPassphrase } = buildChallenge(kp.publicKey());
  const tx = TransactionBuilder.fromXDR(transaction, networkPassphrase);
  tx.sign(kp);

  const user = await verifyChallenge(tx.toXDR());
  assert.equal(user.address, kp.publicKey());
  assert.ok(user.userId);
});

test('SEP-10: a challenge signed by the wrong key is rejected', async () => {
  const kp = Keypair.random();
  const attacker = Keypair.random();
  const { transaction, networkPassphrase } = buildChallenge(kp.publicKey());
  const tx = TransactionBuilder.fromXDR(transaction, networkPassphrase);
  tx.sign(attacker);
  await assert.rejects(verifyChallenge(tx.toXDR()));
});

test('SEP-10: a garbage challenge is rejected', async () => {
  await assert.rejects(verifyChallenge('not-a-transaction-envelope'));
});

test('CORS only reflects the configured web origin', async () => {
  const allowed = await fetch(base + '/health', { headers: { Origin: 'http://localhost:3001' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3001');

  const denied = await fetch(base + '/health', { headers: { Origin: 'http://evil.example' } });
  assert.notEqual(denied.headers.get('access-control-allow-origin'), 'http://evil.example');
});

test('the SEP-10 toml endpoint is the only route with a wildcard CORS header', async () => {
  const toml = await fetch(base + '/.well-known/stellar.toml');
  assert.equal(toml.headers.get('access-control-allow-origin'), '*');
});
