import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchBrokerEstimate } from './stellarbroker-provider.js';

const query = { sellingAsset: 'XLM', buyingAsset: 'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', sellingAmount: '10', slippageTolerance: 0.01 };

function listen(handler: (req: IncomingMessage, close: () => void) => unknown) {
  let closed: () => void = () => undefined;
  const closedPromise = new Promise<void>((r) => (closed = r));
  const server = createServer((req, res) => {
    req.on('close', () => closed());
    const out = handler(req, () => closed());
    if (out !== 'hang') res.end(JSON.stringify(out));
  });
  return new Promise<{ origin: string; closedPromise: Promise<void>; stop: () => Promise<void> }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        closedPromise,
        stop: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
      }),
    ),
  );
}

test('aborting a broker quote closes the upstream request', async () => {
  const s = await listen(() => 'hang');
  const controller = new AbortController();
  const pending = fetchBrokerEstimate(s.origin, query, controller.signal);
  setTimeout(() => controller.abort(new Error('quote timed out')), 50);
  await assert.rejects(pending, /quote timed out/);
  await Promise.race([
    s.closedPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('upstream request was not cancelled')), 2000)),
  ]);
  await s.stop();
});

test('a broker quote sends the expected query and parses a success body', async () => {
  let seen = '';
  const s = await listen((req) => {
    seen = req.url ?? '';
    return { status: 'success', estimatedBuyingAmount: '1.2345678', directTrade: { path: ['XLM', 'USDC'] } };
  });
  const out = await fetchBrokerEstimate(s.origin, query);
  assert.equal(out.status, 'success');
  assert.equal(out.estimatedBuyingAmount, '1.2345678');
  assert.match(seen, /^\/quote\?sellingAsset=XLM&buyingAsset=USDC-GA5ZSEJY/);
  assert.match(seen, /sellingAmount=10&slippageTolerance=0\.01/);
  await s.stop();
});

test('a broker that cannot route is reported by status, not thrown', async () => {
  const s = await listen(() => ({ status: 'unfeasible' }));
  assert.equal((await fetchBrokerEstimate(s.origin, query)).status, 'unfeasible');
  await s.stop();
});
