import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoutableSymbol, listRoutableAssets, resolveAsset } from './assets.js';

test('the default registry is multi-currency', () => {
  const codes = listRoutableAssets().map((a) => a.symbol);
  assert.deepEqual(new Set(codes), new Set(['XLM', 'USDC', 'EURC']));
});

test('isRoutableSymbol is case-insensitive and rejects unknowns', () => {
  assert.equal(isRoutableSymbol('eurc'), true);
  assert.equal(isRoutableSymbol('XLM'), true);
  assert.equal(isRoutableSymbol('DOGE'), false);
});

test('resolveAsset returns native XLM without an issuer', () => {
  const xlm = resolveAsset('xlm');
  assert.equal(xlm.asset.isNative(), true);
  assert.equal(xlm.ref.issuer, undefined);
});

test('resolveAsset returns issued credit assets with a contract id', () => {
  const usdc = resolveAsset('USDC');
  assert.ok(usdc.ref.issuer);
  assert.match(usdc.contractId, /^C[A-Z0-9]{55}$/);
});

test('resolveAsset throws for an unconfigured asset', () => {
  assert.throws(() => resolveAsset('USDT'), /not routable/);
});
