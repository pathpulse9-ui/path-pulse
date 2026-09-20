import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { closeDb } from '../db/client.js';
import { env } from '../config/env.js';
import { startTestApi, stopTestApi } from './testSupport.js';

let server: Server | undefined;
let base = '';

before(async () => {
  ({ server, base } = await startTestApi());
});

after(async () => {
  await stopTestApi(server);
  await closeDb();
});

const get = (p: string, init?: RequestInit) => fetch(base + p, init);
const postJson = (p: string, body: unknown, init: RequestInit = {}) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
    body: JSON.stringify(body),
    ...init,
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

/** A guest session cookie — the minimum any authenticated caller can hold. */
async function guestCookie(): Promise<string> {
  const res = await postJson('/v1/auth/guest', {});
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

/** An operator session cookie — required by every fund-moving endpoint. */
async function opsCookie(): Promise<string> {
  const res = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode });
  assert.equal(res.status, 200, 'ops login should succeed with the configured passcode');
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}
const authed = (cookie: string) => ({ headers: { cookie } });

test('GET /health reports network and version', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.status, 'ok');
  assert.equal(body.network, 'testnet');
  assert.ok(body.version);
});

test('GET /.well-known/stellar.toml is public and carries the signing key', async () => {
  const res = await get('/.well-known/stellar.toml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const text = await res.text();
  assert.match(text, /SIGNING_KEY="G[A-Z0-9]{55}"/);
});

test('GET /v1/auth/me without a cookie returns a null user', async () => {
  const res = await get('/v1/auth/me');
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { user: null });
});

test('guest session round-trips through an httpOnly cookie', async () => {
  const res = await postJson('/v1/auth/guest', {});
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /pathpulse_session=/);
  assert.match(setCookie, /HttpOnly/i);

  const me = await get('/v1/auth/me', { headers: { cookie: setCookie.split(';')[0] } });
  const body = await json(me);
  assert.equal(body.user.method, 'guest');
  assert.match(body.user.userId, /^guest_/);
});

test('POST /v1/auth/partner/login rejects a wrong passcode', async () => {
  const res = await postJson('/v1/auth/partner/login', { passcode: 'not-it' });
  assert.equal(res.status, 401);
});

test('partner session round-trips through an httpOnly cookie', async () => {
  assert.ok(env.govPartnerPasscode, 'GOV_PARTNER_PASSCODE must be set for this test');
  const res = await postJson('/v1/auth/partner/login', { passcode: env.govPartnerPasscode });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /pathpulse_session=/);
  assert.match(setCookie, /HttpOnly/i);

  const me = await get('/v1/auth/me', { headers: { cookie: setCookie.split(';')[0] } });
  const body = await json(me);
  assert.equal(body.user.method, 'partner');
  assert.match(body.user.userId, /^partner_/);
});

test('POST /v1/tx/build without a session is rejected', async () => {
  const res = await postJson('/v1/tx/build', {
    userId: 'someone-elses-id',
    operations: [{ type: 'payment', destination: 'GA', asset: { code: 'XLM' }, amount: '1' }],
  });
  assert.equal(res.status, 401);
  assert.equal((await json(res)).error, 'unauthorized');
});

test('POST /v1/routing/swap without a session is rejected before any network call', async () => {
  const res = await postJson('/v1/routing/swap', { from: 'XLM', to: 'USDC', amount: '10' });
  assert.equal(res.status, 401);
});

test('GET /v1/routing/quote rejects an identical asset pair', async () => {
  const res = await get('/v1/routing/quote?from=XLM&to=XLM&amount=10');
  assert.equal(res.status, 400);
});

test('GET /v1/routing/quote rejects an unknown asset', async () => {
  const res = await get('/v1/routing/quote?from=XLM&to=DOGE&amount=10');
  assert.equal(res.status, 400);
});

test('GET /v1/routing/assets lists the routable set', async () => {
  const res = await get('/v1/routing/assets');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.some((a: { symbol: string }) => a.symbol === 'USDC'));
});

test('GET /v1/routing/treasury/plan describes the treasury holdings and settlement target', async () => {
  const res = await get('/v1/routing/treasury/plan');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.settlementAsset.code, 'USDC');
  assert.ok(Array.isArray(body.balances));
  assert.ok(Array.isArray(body.conversions));
  assert.ok(typeof body.projectedSettlementAsset === 'string');
});

test('POST /v1/settlement/batches rejects an empty body', async () => {
  const res = await postJson('/v1/settlement/batches', {}, authed(await opsCookie()));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'ValidationError');
});

test('POST /v1/settlement/batches rejects a malformed gross amount', async () => {
  const res = await postJson(
    '/v1/settlement/batches',
    { grossAmount: 'lots', drivers: [{ userId: 'd1', address: 'GABC', tier: 1 }] },
    authed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('GET /v1/settlement/batches/:id returns 404 for an unknown batch', async () => {
  const res = await get('/v1/settlement/batches/stl_does_not_exist');
  assert.equal(res.status, 404);
});

test('POST /v1/settlement/group-payouts rejects an invalid Stellar address', async () => {
  const res = await postJson(
    '/v1/settlement/group-payouts',
    { recipients: [{ name: 'Test', address: 'not-a-key', amount: '1.5' }] },
    authed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('POST /v1/settlement/group-payouts rejects an empty recipient list', async () => {
  const res = await postJson(
    '/v1/settlement/group-payouts',
    { recipients: [] },
    authed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('GET /v1/offramp/quotes requires a positive amount', async () => {
  assert.equal((await get('/v1/offramp/quotes')).status, 400);
  assert.equal((await get('/v1/offramp/quotes?amount=-3')).status, 400);
  assert.equal((await get('/v1/offramp/quotes?amount=abc')).status, 400);
});

test('POST /v1/offramp/callback fails closed without a valid signature', async () => {
  const res = await postJson('/v1/offramp/callback', { status: 'completed', order_id: '1' });
  assert.equal(res.status, 401);
  assert.equal((await json(res)).error, 'InvalidSignature');
});

test('GET /v1/ops/payouts/batches/:id returns 404 for an unknown batch', async () => {
  const res = await get('/v1/ops/payouts/batches/pob_missing');
  assert.equal(res.status, 404);
});

// Regression guard: these endpoints move value or expose per-user records and
// were reachable from the public internet with no session at all. An anonymous
// caller must get 401 before any validation or business logic runs.
test('value-moving endpoints reject anonymous callers', async () => {
  const cases: [string, unknown][] = [
    ['/v1/settlement/batches', { grossAmount: '1', drivers: [{ userId: 'x', address: 'GABC', tier: 1 }] }],
    ['/v1/settlement/group-payouts', { recipients: [{ name: 'A', address: 'GABC', amount: '1' }] }],
    ['/v1/ops/payouts/batches', { settlementBatchId: 'stl_whatever' }],
    ['/v1/scout/assign', { score: 0.9 }],
    ['/v1/treasury/multisig/build', {}],
    ['/v1/offramp/sessions', { amount: '10' }],
  ];
  for (const [path, body] of cases) {
    const res = await postJson(path, body);
    assert.equal(res.status, 401, `${path} should be 401 without a session`);
    assert.equal((await json(res)).error, 'Unauthorized', `${path} error code`);
  }
});

// The point of the ops role: a caller can hold a perfectly valid session and
// still be refused. 401 says "authenticate"; 403 says "you are known, and still
// not allowed to move protocol funds".
test('a guest session cannot reach fund-moving endpoints (403, not 401)', async () => {
  const guest = await guestCookie();
  const cases: [string, unknown][] = [
    ['/v1/settlement/batches', { grossAmount: '1', drivers: [{ userId: 'x', address: 'GABC', tier: 1 }] }],
    ['/v1/settlement/group-payouts', { recipients: [{ name: 'A', address: 'GABC', amount: '1' }] }],
    ['/v1/ops/payouts/batches', { settlementBatchId: 'stl_whatever' }],
    ['/v1/scout/assign', { score: 0.9 }],
    ['/v1/treasury/multisig/build', {}],
  ];
  for (const [path, body] of cases) {
    const res = await postJson(path, body, authed(guest));
    assert.equal(res.status, 403, `${path} should be 403 for a non-ops session`);
    assert.equal((await json(res)).error, 'Forbidden', `${path} error code`);
  }
});

test('ops session round-trips and is accepted where a guest is refused', async () => {
  assert.ok(env.opsPasscode, 'OPS_PASSCODE must be set for this test');
  const cookie = await opsCookie();
  const me = await json(await get('/v1/auth/me', authed(cookie)));
  assert.equal(me.user.method, 'ops');
  assert.match(me.user.userId, /^ops_/);

  // Reaches validation rather than the role gate — proves the gate let it past.
  const res = await postJson('/v1/settlement/batches', {}, authed(cookie));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'ValidationError');
});

test('POST /v1/auth/ops/login rejects a wrong passcode', async () => {
  const res = await postJson('/v1/auth/ops/login', { passcode: 'not-it' });
  assert.equal(res.status, 401);
});

test('off-ramp session reads reject anonymous callers', async () => {
  assert.equal((await get('/v1/offramp/sessions')).status, 401);
  assert.equal((await get('/v1/offramp/sessions/ofr_anything')).status, 401);
});

test('carret KYC/PII endpoints reject anonymous callers', async () => {
  assert.equal((await get('/v1/carret/kyc/status/99999')).status, 401);
  assert.equal((await postJson('/v1/carret/kyc/initiate', { account_id: 99999 })).status, 401);
  assert.equal((await postJson('/v1/carret/kyc/cleanup', { account_id: 99999 })).status, 401);
});

test("one driver cannot read another driver's off-ramp sessions", async () => {
  const a = await guestCookie();
  const b = await guestCookie();
  const listA = await json(await get('/v1/offramp/sessions', authed(a)));
  const listB = await json(await get('/v1/offramp/sessions', authed(b)));
  // Fresh guests own nothing, and neither can see the other's (or anyone's) rows.
  assert.deepEqual(listA.items, []);
  assert.deepEqual(listB.items, []);
});

test('security headers are present', async () => {
  const res = await get('/health');
  assert.ok(res.headers.get('x-content-type-options'), 'x-content-type-options');
  assert.ok(res.headers.get('x-frame-options') ?? res.headers.get('content-security-policy'));
});

test('unknown route falls through to a 404', async () => {
  const res = await get('/v1/nope');
  assert.equal(res.status, 404);
});
