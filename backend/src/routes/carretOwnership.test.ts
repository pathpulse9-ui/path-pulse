import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

let server: Server | undefined;
let base = '';
let cookieName = '';
let createSessionToken: (p: { userId: string; method: 'guest' | 'google'; email?: string }) => string = () => '';
let getMapping: (userId: string) => Promise<{ carretAccountId: string } | null> = async () => null;
let cleanup: () => Promise<void> = async () => {};

const owner = `carret_owner_${randomUUID()}`;
const intruder = `carret_intruder_${randomUUID()}`;
const unmapped = `carret_unmapped_${randomUUID()}`;
const ownerAccount = String(900000000 + Math.floor(Math.random() * 1000000));
const ownerEmail = `owner_${randomUUID()}@example.com`;
const ownerPhone = String(7000000000 + Math.floor(Math.random() * 999999999));
const googleOwner = `carret_google_${randomUUID()}`;

before(async () => {
  if (skip) return;
  const { startTestApi, stopTestApi } = await import('./testSupport.js');
  const { env } = await import('../config/env.js');
  const { closeDb } = await import('../db/client.js');
  const store = await import('../services/carretSubAccountStore.js');
  const { upsertMapping, deleteMapping } = store;
  getMapping = store.getMapping;
  ({ createSessionToken } = await import('../services/session.js'));
  cookieName = env.session.cookieName;
  ({ server, base } = await startTestApi());
  await upsertMapping({
    userId: owner,
    carretAccountId: ownerAccount,
    referenceId: 'ref',
    kycStatus: 'pending',
    email: ownerEmail,
    phone: ownerPhone,
  });
  await upsertMapping({ userId: intruder, carretAccountId: '1', referenceId: 'ref2', kycStatus: 'pending' });
  cleanup = async () => {
    await deleteMapping(owner);
    await deleteMapping(intruder);
    await deleteMapping(unmapped);
    await deleteMapping(googleOwner);
    await stopTestApi(server);
    await closeDb();
  };
});

after(async () => {
  await cleanup();
});

function call(userId: string, method: string, path: string, body?: unknown, email?: string) {
  const session = email ? { userId, method: 'google' as const, email } : { userId, method: 'guest' as const };
  return fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `${cookieName}=${createSessionToken(session)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("a driver cannot read, initiate or clean up another driver's Carret KYC", { skip }, async () => {
  const attempts = [
    call(intruder, 'GET', `/v1/carret/kyc/status/${ownerAccount}`),
    call(intruder, 'POST', '/v1/carret/kyc/initiate', { account_id: ownerAccount }),
    call(intruder, 'POST', '/v1/carret/kyc/cleanup', { account_id: Number(ownerAccount) }),
  ];
  for (const res of await Promise.all(attempts)) {
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'Forbidden');
  }
});

test('a driver without a Carret account is told to provision first', { skip }, async () => {
  const attempts = [
    call(unmapped, 'POST', '/v1/carret/kyc/initiate', { account_id: ownerAccount }),
    call(unmapped, 'POST', '/v1/carret/kyc/document', {
      kyc_session_id: 'someone-elses-session',
      document: { document_type: 'pan', document_number: 'ABCDE1234F' },
    }),
  ];
  for (const res of await Promise.all(attempts)) {
    assert.equal(res.status, 422);
    assert.equal(((await res.json()) as { error: string }).error, 'NoMapping');
  }
});

const provision = (email: string, phone: string) => ({
  email,
  phone_number: phone,
  first_name: 'A',
  last_name: 'B',
  annual_income: '0-5L',
  country: 'IN',
  gender: 'other',
  occupation: 'driver',
  dob: '01/01/1990',
});

test("an unverified caller cannot adopt another driver's Carret account by email or phone", { skip }, async () => {
  const unverified = [
    call(unmapped, 'POST', '/v1/carret/provision-subaccount', provision(ownerEmail, '9999999999')),
    call(unmapped, 'POST', '/v1/carret/provision-subaccount', provision(`x_${randomUUID()}@example.com`, ownerPhone)),
    call(unmapped, 'POST', '/v1/carret/provision-subaccount', provision(ownerEmail, ownerPhone), `other_${randomUUID()}@example.com`),
  ];
  for (const res of await Promise.all(unverified)) {
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'EmailNotVerified');
  }
  const ownEmail = `x_${randomUUID()}@example.com`;
  const phoneClash = await call(unmapped, 'POST', '/v1/carret/provision-subaccount', provision(ownEmail, ownerPhone), ownEmail);
  assert.equal(phoneClash.status, 409);
  assert.equal(((await phoneClash.json()) as { error: string }).error, 'CarretAccountExists');
  assert.equal(await getMapping(unmapped), null);
  assert.equal((await getMapping(owner))?.carretAccountId, ownerAccount);
});

test('a Google session verified for the same email resumes the Carret account', { skip }, async () => {
  const res = await call(googleOwner, 'POST', '/v1/carret/provision-subaccount', provision(ownerEmail.toUpperCase(), ownerPhone), ownerEmail);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { carretAccountId: ownerAccount, kycStatus: 'pending', existed: true });
});
