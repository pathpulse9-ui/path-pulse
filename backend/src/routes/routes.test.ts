import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { closeDb } from '../db/client.js';
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
  const res = await postJson('/v1/settlement/batches', {});
  assert.equal(res.status, 400);
  assert.equal((await json(res)).error, 'ValidationError');
});

test('POST /v1/settlement/batches rejects a malformed gross amount', async () => {
  const res = await postJson('/v1/settlement/batches', {
    grossAmount: 'lots',
    drivers: [{ userId: 'd1', address: 'GABC', tier: 1 }],
  });
  assert.equal(res.status, 400);
});

test('GET /v1/settlement/batches/:id returns 404 for an unknown batch', async () => {
  const res = await get('/v1/settlement/batches/stl_does_not_exist');
  assert.equal(res.status, 404);
});

test('POST /v1/settlement/group-payouts rejects an invalid Stellar address', async () => {
  const res = await postJson('/v1/settlement/group-payouts', {
    recipients: [{ name: 'Test', address: 'not-a-key', amount: '1.5' }],
  });
  assert.equal(res.status, 400);
});

test('POST /v1/settlement/group-payouts rejects an empty recipient list', async () => {
  const res = await postJson('/v1/settlement/group-payouts', { recipients: [] });
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

test('unknown route falls through to a 404', async () => {
  const res = await get('/v1/nope');
  assert.equal(res.status, 404);
});
