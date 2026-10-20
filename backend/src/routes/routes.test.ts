import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { closeDb } from '../db/client.js';
import { env } from '../config/env.js';
import { startTestApi, stopTestApi } from './testSupport.js';
import { createSessionToken } from '../services/session.js';

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

async function guestCookie(): Promise<string> {
  const res = await postJson('/v1/auth/guest', {});
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

const mintedGuest = (userId = `guest_${randomUUID()}`) =>
  `${env.session.cookieName}=${createSessionToken({ userId, method: 'guest' })}`;

const mintedOperator = (email = env.opsOperators.find((o) => o.includes('@')) ?? `op_${randomUUID()}@example.com`) =>
  `${env.session.cookieName}=${createSessionToken({ userId: randomUUID(), method: 'google', email })}`;

async function opsCookie(): Promise<string> {
  const res = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode }, authedJson(mintedOperator()));
  assert.equal(res.status, 200, 'ops login should succeed with the configured passcode');
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}
const authed = (cookie: string) => ({ headers: { cookie } });
const authedJson = (cookie: string) => ({ headers: { cookie, 'content-type': 'application/json' } });
const keyed = (cookie: string, key: string = randomUUID()) => ({
  headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key },
});

test('GET /health reports network and version', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.status, 'ok');
  assert.equal(body.network, 'testnet');
  assert.ok(body.version);
});

test('GET /health/ready reports each dependency without leaking error detail', async () => {
  const res = await get('/health/ready');
  assert.ok([200, 503].includes(res.status));
  const body = await json(res);
  assert.equal(typeof body.ok, 'boolean');
  assert.ok(body.checks.some((c: { name: string }) => c.name === 'horizon'));
  for (const c of body.checks) assert.deepEqual(Object.keys(c).sort(), ['latencyMs', 'name', 'ok']);
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
  assert.equal((await get('/v1/routing/treasury/plan')).status, 401);
  const res = await get('/v1/routing/treasury/plan', authed(await opsCookie()));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.settlementAsset.code, 'USDC');
  assert.ok(Array.isArray(body.balances));
  assert.ok(Array.isArray(body.conversions));
  assert.ok(typeof body.projectedSettlementAsset === 'string');
});

test('POST /v1/settlement/batches rejects an empty body', async () => {
  const res = await postJson('/v1/settlement/batches', {}, keyed(await opsCookie()));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'ValidationError');
});

test('POST /v1/settlement/batches rejects a malformed gross amount', async () => {
  const res = await postJson(
    '/v1/settlement/batches',
    { grossAmount: 'lots', drivers: [{ userId: 'd1', address: 'GABC', tier: 1 }] },
    keyed(await opsCookie()),
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
    keyed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('POST /v1/settlement/group-payouts rejects an empty recipient list', async () => {
  const res = await postJson(
    '/v1/settlement/group-payouts',
    { recipients: [] },
    keyed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('GET /v1/offramp/quotes needs a session and a positive amount', async () => {
  assert.equal((await get('/v1/offramp/quotes?amount=1')).status, 401);
  const guest = authed(mintedGuest());
  assert.equal((await get('/v1/offramp/quotes', guest)).status, 400);
  assert.equal((await get('/v1/offramp/quotes?amount=-3', guest)).status, 400);
  assert.equal((await get('/v1/offramp/quotes?amount=abc', guest)).status, 400);
});

test('POST /v1/offramp/callback fails closed without a valid signature', async () => {
  const res = await postJson('/v1/offramp/callback', { status: 'completed', order_id: '1' });
  assert.equal(res.status, 401);
  assert.equal((await json(res)).error, 'InvalidSignature');
});

test('GET /v1/ops/payouts/batches/:id returns 404 for an unknown batch', async () => {
  const res = await get('/v1/ops/payouts/batches/pob_missing', authed(await opsCookie()));
  assert.equal(res.status, 404);
});

test('value-moving endpoints reject anonymous callers', async () => {
  const cases: [string, unknown][] = [
    ['/v1/settlement/batches', { grossAmount: '1', drivers: [{ userId: 'x', address: 'GABC', tier: 1 }] }],
    ['/v1/settlement/converted', { from: 'XLM', amount: '1', drivers: [{ userId: 'x', address: 'GABC' }] }],
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

test('a guest session cannot reach fund-moving endpoints (403, not 401)', async () => {
  const guest = await guestCookie();
  const cases: [string, unknown][] = [
    ['/v1/settlement/batches', { grossAmount: '1', drivers: [{ userId: 'x', address: 'GABC', tier: 1 }] }],
    ['/v1/settlement/group-payouts', { recipients: [{ name: 'A', address: 'GABC', amount: '1' }] }],
    ['/v1/ops/payouts/batches', { settlementBatchId: 'stl_whatever' }],
    ['/v1/scout/assign', { score: 0.9 }],
    ['/v1/treasury/multisig/build', {}],
    ['/v1/routing/swap', { from: 'XLM', to: 'USDC', amount: '10' }],
  ];
  for (const [path, body] of cases) {
    const res = await postJson(path, body, authed(guest));
    assert.equal(res.status, 403, `${path} should be 403 for a non-ops session`);
    assert.equal((await json(res)).error, 'Forbidden', `${path} error code`);
  }
});

test('ops session round-trips and is accepted where a guest is refused', async () => {
  assert.ok(env.opsPasscode, 'OPS_PASSCODE must be set for this test');
  const operator = mintedOperator();
  const before = await json(await get('/v1/auth/me', authed(operator)));
  const login = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode }, authedJson(operator));
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const me = await json(await get('/v1/auth/me', authed(cookie)));
  assert.equal(me.user.method, 'google');
  assert.equal(me.user.role, 'ops');
  assert.equal(me.user.userId, before.user.userId);

  const res = await postJson('/v1/settlement/batches', {}, keyed(cookie));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'ValidationError');
});

test('a guest session cannot be elevated to operator even with the passcode', async () => {
  const res = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode }, authedJson(mintedGuest()));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('an elevated cookie is revoked once the operator exits', async () => {
  const cookie = await opsCookie();
  await postJson('/v1/auth/ops/exit', {}, authed(cookie));
  assert.equal((await postJson('/v1/settlement/batches', {}, keyed(cookie))).status, 401);
});

test('a logged-out cookie no longer authenticates', async () => {
  const cookie = await guestCookie();
  assert.equal((await get('/v1/me/payouts', authed(cookie))).status, 200);
  await postJson('/v1/auth/logout', {}, authed(cookie));
  assert.equal((await get('/v1/me/payouts', authed(cookie))).status, 401);
});

function recentSince(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('compliance exports need a partner or operator session', async () => {
  assert.equal((await get('/v1/settlement/batches/export.csv')).status, 401);
  assert.equal((await get('/v1/settlement/batches/payouts.csv', authed(mintedGuest()))).status, 403);
  assert.equal((await get('/v1/settlement/batches/stl_x/receipt.pdf')).status, 401);
  assert.equal((await get(`/v1/settlement/batches/export.csv?since=${recentSince()}`, authed(await opsCookie()))).status, 200);
  assert.equal((await get('/v1/settlement/batches/export.csv', authed(await opsCookie()))).status, 400);
});

test('anonymous settlement reads never expose driver user ids', async () => {
  const body = await json(await get('/v1/settlement/batches?limit=20'));
  for (const batch of body.items) {
    assert.equal(batch.createdBy, undefined);
    for (const p of batch.driverPayouts) assert.equal(p.userId, 'redacted');
  }
});

test('a partner API key opens partner reads until it is revoked', async () => {
  const ops = await opsCookie();
  const created = await json(await postJson('/v1/ops/partner-keys', { name: 'ministry-test' }, authedJson(ops)));
  assert.match(created.key, /^pp_[0-9a-f]{16}_/);
  const bearer = { headers: { authorization: `Bearer ${created.key}` } };
  assert.equal((await get(`/v1/settlement/batches/export.csv?since=${recentSince()}`, bearer)).status, 200);
  assert.equal((await get('/v1/gov/ledger?limit=1', bearer)).status, 200);
  assert.equal((await get('/v1/ops/payouts/batches', bearer)).status, 401);
  const partnerView = await json(await get('/v1/settlement/batches?limit=20', bearer));
  for (const batch of partnerView.items) {
    for (const p of batch.driverPayouts) assert.notEqual(p.userId, 'redacted');
  }
  const forged = { headers: { authorization: `Bearer ${created.key.slice(0, -2)}xx` } };
  assert.equal((await get('/v1/gov/ledger', forged)).status, 401);
  assert.equal((await get('/v1/settlement/batches?limit=1', forged)).status, 401);
  const del = await fetch(`${base}/v1/ops/partner-keys/${created.record.id}`, { method: 'DELETE', headers: { cookie: ops } });
  assert.equal(del.status, 204);
  assert.equal((await get('/v1/gov/ledger', bearer)).status, 401);
});

test('operator payout reads are operator-only', async () => {
  assert.equal((await get('/v1/ops/payouts/batches')).status, 401);
  assert.equal((await get('/v1/ops/payouts/batches', authed(mintedGuest()))).status, 403);
  assert.equal((await get('/v1/ops/payouts/batches/x/attempts', authed(mintedGuest()))).status, 403);
  assert.equal((await get('/v1/ops/payouts/batches', authed(await opsCookie()))).status, 200);
});

test('a partner can read a single payout batch for the gov trace but not list them', async () => {
  const login = await postJson('/v1/auth/partner/login', { passcode: env.govPartnerPasscode });
  const partner = (login.headers.get('set-cookie') ?? '').split(';')[0];
  assert.equal((await get('/v1/ops/payouts/batches/pob_missing', authed(partner))).status, 404);
  assert.equal((await get('/v1/ops/payouts/batches', authed(partner))).status, 403);
});

test('value-moving endpoints refuse a request with no Idempotency-Key', async () => {
  const ops = await opsCookie();
  const guest = await guestCookie();
  const cases: [string, unknown, string][] = [
    ['/v1/settlement/batches', { grossAmount: '1', drivers: [] }, ops],
    ['/v1/settlement/group-payouts', { recipients: [] }, ops],
    ['/v1/ops/payouts/batches', { settlementBatchId: 'stl_whatever' }, ops],
    ['/v1/offramp/sessions', { amount: '10' }, guest],
    ['/v1/routing/swap', { from: 'XLM', to: 'USDC', amount: '10' }, ops],
  ];
  for (const [path, body, cookie] of cases) {
    const res = await postJson(path, body, authed(cookie));
    assert.equal(res.status, 400, `${path} should be 400 without a key`);
    assert.equal((await json(res)).error, 'IdempotencyKeyRequired', `${path} error code`);
  }
});

test('an oversized Idempotency-Key is refused', async () => {
  const res = await postJson('/v1/settlement/batches', {}, keyed(await opsCookie(), 'k'.repeat(256)));
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'IdempotencyKeyInvalid');
});

test('rewards history and device registration require a session', async () => {
  assert.equal((await get('/v1/me/payouts')).status, 401);
  assert.equal((await postJson('/v1/me/devices', { token: 'x'.repeat(64), platform: 'ios' })).status, 401);
  assert.equal((await fetch(base + '/v1/me/devices/abc', { method: 'DELETE' })).status, 401);
});

test('a guest without a wallet gets an empty rewards page', async () => {
  const res = await get('/v1/me/payouts', authed(await guestCookie()));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.deepEqual(body, { address: null, balances: [], items: [], nextCursor: null });
});

test('device registration validates the platform and round-trips', async () => {
  const cookie = await guestCookie();
  const token = randomUUID().replace(/-/g, '').repeat(2);
  const bad = await postJson('/v1/me/devices', { token, platform: 'web' }, keyed(cookie));
  assert.equal(bad.status, 400);
  const ok = await postJson('/v1/me/devices', { token, platform: 'android' }, keyed(cookie));
  assert.equal(ok.status, 204);
  const del = await fetch(`${base}/v1/me/devices/${token}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(del.status, 204);
});

test('operator access cannot be unlocked without an identity to attach it to', async () => {
  const res = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('exiting operator mode keeps the identity and closes the gate', async () => {
  const cookie = await opsCookie();
  const { user: elevated } = await json(await get('/v1/auth/me', authed(cookie)));
  const exit = await postJson('/v1/auth/ops/exit', {}, authed(cookie));
  const after = (exit.headers.get('set-cookie') ?? '').split(';')[0];
  const { user } = await json(await get('/v1/auth/me', authed(after)));
  assert.equal(user.userId, elevated.userId);
  assert.equal(user.role, undefined);
  assert.equal((await postJson('/v1/settlement/batches', {}, keyed(after))).status, 403);
});

test('an operator cookie from before the role split no longer passes the gate', async () => {
  const legacy = `${env.session.cookieName}=${createSessionToken({ userId: `ops_${randomUUID()}`, method: 'ops' } as never)}`;
  const res = await postJson('/v1/settlement/batches', {}, keyed(legacy));
  assert.equal(res.status, 403);
});

test('the ops status page is operator-only and reports checks and alerting', async () => {
  assert.equal((await get('/v1/ops/status')).status, 401);
  assert.equal((await get('/v1/ops/status', authed(mintedGuest()))).status, 403);
  const res = await get('/v1/ops/status?refresh=true', authed(await opsCookie()));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.monitor.report.network, 'testnet');
  assert.ok(body.monitor.report.checks.some((c: { name: string }) => c.name === 'horizon'));
  assert.equal(typeof body.alerting.webhookConfigured, 'boolean');
  assert.ok(Array.isArray(body.alerts));
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

test('reconciliation and missed-webhook simulation are operator-only', async () => {
  const guest = authed(mintedGuest());
  assert.equal((await postJson('/v1/ops/offramp/reconcile-once', {}, guest)).status, 403);
  assert.equal((await postJson('/v1/ops/offramp/reconcile-once', {})).status, 401);
  assert.equal((await postJson('/v1/ops/offramp/sessions/x/simulate-missed-webhook', {}, guest)).status, 403);
});

test('group payout reads need a partner or operator session', async () => {
  assert.equal((await get('/v1/settlement/group-payouts')).status, 401);
  assert.equal((await get('/v1/settlement/group-payouts/grp_x')).status, 401);
  assert.equal((await get('/v1/settlement/group-payouts', authed(mintedGuest()))).status, 403);
  assert.equal((await get('/v1/settlement/group-payouts', authed(await opsCookie()))).status, 200);
});

test('oversized amounts and malformed list params are rejected with 400', async () => {
  const ops = await opsCookie();
  const huge = '9'.repeat(40);
  assert.equal((await get(`/v1/offramp/quotes?amount=${huge}`, authed(mintedGuest()))).status, 400);
  assert.equal((await postJson('/v1/settlement/batches', { grossAmount: huge, drivers: [] }, keyed(ops))).status, 400);
  assert.equal((await get('/v1/settlement/batches?limit=abc')).status, 400);
  assert.equal((await get('/v1/settlement/batches?limit=-5')).status, 400);
  assert.equal((await get('/v1/gov/ledger?account=not-a-key', authed(ops))).status, 400);
});

test('reserved service-account ids cannot be used as drivers', async () => {
  const res = await postJson(
    '/v1/settlement/batches',
    {
      grossAmount: '1',
      drivers: [{ userId: '__reserve_sponsor__', address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }],
    },
    keyed(await opsCookie()),
  );
  assert.equal(res.status, 400);
});

test('the Carret claim-account route is gone', async () => {
  const res = await postJson('/v1/carret/claim-account', { account_id: '1' }, authedJson(await guestCookie()));
  assert.equal(res.status, 404);
});

test('a session revoked in the database is refused on session and role routes', async () => {
  const { db } = await import('../db/client.js');
  const jwt = (await import('jsonwebtoken')).default;
  const revoke = async (cookie: string) => {
    const token = cookie.split('=')[1];
    const { jti } = jwt.decode(token) as { jti: string };
    await db().query("insert into revoked_sessions (jti, expires_at) values ($1, now() + interval '1 hour')", [jti]);
  };
  const guest = mintedGuest();
  assert.equal((await get('/v1/offramp/sessions', authed(guest))).status, 200);
  await revoke(guest);
  assert.equal((await get('/v1/offramp/sessions', authed(guest))).status, 401);
  const ops = await opsCookie();
  assert.equal((await get('/v1/ops/payouts/batches', authed(ops))).status, 200);
  await revoke(ops);
  assert.equal((await get('/v1/ops/payouts/batches', authed(ops))).status, 401);
});

test('building a transaction signs for the session user, never a body-supplied one', async () => {
  const guestId = `guest_${randomUUID()}`;
  const res = await postJson(
    '/v1/tx/build',
    { userId: 'victim-user-id', operations: [{ type: 'changeTrust', asset: { code: 'USDC' } }] },
    authedJson(mintedGuest(guestId)),
  );
  const body = await json(res);
  assert.equal(res.status, 404);
  assert.ok(String(body.message).includes(guestId));
  assert.ok(!String(body.message).includes('victim-user-id'));
});

test('random partner key ids from one address share a single rate limit', async () => {
  let limited = 0;
  for (let i = 0; i < 320; i += 1) {
    const fake = `pp_${randomUUID().replace(/-/g, '').slice(0, 16)}_${'A'.repeat(43)}`;
    const res = await get('/v1/settlement/batches?limit=1', { headers: { authorization: `Bearer ${fake}` } });
    if (res.status === 429) limited += 1;
  }
  assert.ok(limited > 0);
});

test('a driver reads only their own validation score; the score feed is operator-only', async () => {
  const me = `guest_${randomUUID()}`;
  assert.equal((await get(`/v1/scout/score/someone-else`, authed(mintedGuest(me)))).status, 403);
  assert.notEqual((await get(`/v1/scout/score/${me}`, authed(mintedGuest(me)))).status, 403);
  assert.equal((await get('/v1/scout/feed', authed(mintedGuest()))).status, 403);
  assert.equal((await get('/v1/scout/feed', authed(await opsCookie()))).status, 200);
});

test('KYC uploads outside the image, PDF and XML allowlist are refused before reaching Carret', async () => {
  const form = new FormData();
  form.set('kyc_session', '1');
  form.set('doc_type', 'pan');
  form.set('file_type', 'image');
  form.set('doc_front', new Blob(['#!/bin/sh'], { type: 'application/x-sh' }), 'evil.sh');
  const res = await fetch(`${base}/v1/carret/kyc/file`, { method: 'POST', body: form, headers: { cookie: mintedGuest() } });
  assert.equal(res.status, 415);
});

test('the Carret deposit route no longer accepts a caller-supplied transaction hash', async () => {
  const res = await postJson('/v1/carret/deposit', { amount: '1', txHash: 'a'.repeat(64) }, keyed(mintedGuest()));
  assert.equal(res.status, 400);
});

test('a fund move above the approval threshold waits for a second, different operator', async () => {
  const approvalConfig = env.opsApproval as { threshold: string };
  const previous = approvalConfig.threshold;
  approvalConfig.threshold = '0.5';
  try {
    const first = await opsCookie();
    const body = {
      grossAmount: '1',
      drivers: [{ userId: `drv_${randomUUID()}`, address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }],
    };
    const requested = await postJson('/v1/settlement/batches', body, keyed(first));
    assert.equal(requested.status, 202);
    const approval = await json(requested);
    assert.match(approval.id, /^apr_/);
    assert.equal(approval.status, 'pending');

    const self = await postJson(`/v1/ops/approvals/${approval.id}/approve`, {}, keyed(first));
    assert.equal(self.status, 403);
    assert.equal((await json(self)).error, 'SameOperator');

    const pending = await json(await get('/v1/ops/approvals', authed(first)));
    assert.ok(pending.items.some((a: { id: string }) => a.id === approval.id));

    const second = await opsCookie();
    const ran = await postJson(`/v1/ops/approvals/${approval.id}/approve`, {}, keyed(second));
    assert.equal(ran.status, 422);
    assert.equal((await json(ran)).error, 'DriverAddressMismatch');
    const again = await postJson(`/v1/ops/approvals/${approval.id}/approve`, {}, keyed(await opsCookie()));
    assert.equal((await json(again)).error, 'ApprovalNotPending');
  } finally {
    approvalConfig.threshold = previous;
  }
});

test('a settlement below the threshold still refuses payout addresses the driver does not own', async () => {
  const res = await postJson(
    '/v1/settlement/batches',
    { grossAmount: '0.1', drivers: [{ userId: `drv_${randomUUID()}`, address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }] },
    keyed(await opsCookie()),
  );
  assert.equal(res.status, 422);
  assert.equal((await json(res)).error, 'DriverAddressMismatch');
});

test('a session revoked by another instance is dropped on every route, not only gated ones', async () => {
  const { db } = await import('../db/client.js');
  const jwt = (await import('jsonwebtoken')).default;
  const cookie = mintedGuest();
  assert.notEqual((await json(await get('/v1/auth/me', authed(cookie)))).user, null);
  const { jti } = jwt.decode(cookie.split('=')[1]) as { jti: string };
  await db().query("insert into revoked_sessions (jti, expires_at) values ($1, now() + interval '1 hour')", [jti]);
  assert.equal((await json(await get('/v1/auth/me', authed(cookie)))).user, null);
  assert.equal((await postJson('/v1/tx/build', { operations: [] }, authedJson(cookie))).status, 401);
});

test('an operator with an enrolled authenticator cannot sign in without a fresh code', async () => {
  const { generateTotpSecret, totpAt } = await import('../services/totp.js');
  const email = `op_${randomUUID()}@example.com`;
  const operators = env.opsOperators as string[];
  const secrets = env.opsTotpSecrets as Map<string, string>;
  const secret = generateTotpSecret();
  operators.push(email);
  secrets.set(email, secret);
  try {
    const cookie = mintedOperator(email);
    const missing = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode }, authedJson(cookie));
    assert.equal(missing.status, 401);
    assert.equal((await json(missing)).error, 'TotpRequired');
    const wrong = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode, totp: '000000' }, authedJson(cookie));
    assert.equal(wrong.status, 401);
    const code = totpAt(secret, Math.floor(Date.now() / 30_000));
    const ok = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode, totp: code }, authedJson(cookie));
    assert.equal(ok.status, 200);
    const replay = await postJson('/v1/auth/ops/login', { passcode: env.opsPasscode, totp: code }, authedJson(cookie));
    assert.equal(replay.status, 401);
  } finally {
    operators.splice(operators.indexOf(email), 1);
    secrets.delete(email);
  }
});

test('with GOV_PARTNERS set, the partner passcode only works for a listed signed-in identity', async () => {
  const partners = env.govPartners as string[];
  const email = `partner_${randomUUID()}@example.com`;
  partners.push(email);
  try {
    const anonymous = await postJson('/v1/auth/partner/login', { passcode: env.govPartnerPasscode });
    assert.equal(anonymous.status, 403);
    const stranger = await postJson('/v1/auth/partner/login', { passcode: env.govPartnerPasscode }, authedJson(mintedOperator(`x_${randomUUID()}@example.com`)));
    assert.equal(stranger.status, 403);
    const listed = await postJson('/v1/auth/partner/login', { passcode: env.govPartnerPasscode }, authedJson(mintedOperator(email)));
    assert.equal(listed.status, 200);
  } finally {
    partners.splice(partners.indexOf(email), 1);
  }
});

test('GET requests are rate limited from the shared store', async () => {
  const res = await get('/v1/routing/assets');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('ratelimit-limit'));
  assert.ok(res.headers.get('ratelimit-remaining'));
});

test('the demo SCOUT driver route exists only off mainnet', async () => {
  const res = await postJson('/v1/ops/demo/scout-drivers', {});
  assert.equal(env.network, 'testnet');
  assert.notEqual(res.status, 404);
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(env\.network !== 'mainnet'\) \{\s*router\.post\('\/v1\/ops\/demo\/scout-drivers'/);
});
