import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssetRef, RoutingQuote } from '@pathpulse/contract';
import { Account, Keypair } from '@stellar/stellar-sdk';
import { planConversions, bestStrictSendPath, buildConversionTx, type HeldBalance } from './treasury.js';

const CIRCLE_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const CIRCLE_EURC = 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO';
const AQUA_ISSUER = 'GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER';
const USDC: AssetRef = { code: 'USDC', issuer: CIRCLE_USDC };

function fakeQuote(dest: string, min: string): RoutingQuote {
  return {
    provider: 'aquarius',
    from: { code: 'x' },
    to: USDC,
    sourceAmount: '0',
    destinationAmount: dest,
    minDestinationAmount: min,
    slippageBps: 100,
    hops: 1,
    pools: [],
    route: [],
  };
}

const quoteOk = async () => fakeQuote('101.0000000', '100.0000000');

test('held settlement asset is reported and never queued for conversion', async () => {
  const balances: HeldBalance[] = [{ asset: USDC, balance: '250.0000000' }];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.heldSettlementAsset, '250.0000000');
  assert.equal(plan.conversions.length, 0);
  assert.equal(plan.projectedSettlementAsset, '250.0000000');
});

test('native XLM is left untouched as the fee and reserve asset', async () => {
  const plan = await planConversions([{ asset: { code: 'XLM' }, balance: '500' }], USDC, quoteOk);
  assert.equal(plan.conversions.length, 0);
});

test('a routable non-settlement asset is quoted for conversion', async () => {
  const balances: HeldBalance[] = [{ asset: { code: 'EURC', issuer: CIRCLE_EURC }, balance: '40.0000000' }];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.conversions.length, 1);
  assert.equal(plan.conversions[0].routable, true);
  assert.equal(plan.conversions[0].quote?.minDestinationAmount, '100.0000000');
});

test('an asset outside ROUTING_ASSETS is surfaced as not routable', async () => {
  const balances: HeldBalance[] = [{ asset: { code: 'USDT', issuer: AQUA_ISSUER }, balance: '10' }];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.conversions[0].routable, false);
  assert.match(plan.conversions[0].reason ?? '', /not in ROUTING_ASSETS/);
});

test('settlement-code held under a foreign issuer is flagged as a different asset', async () => {
  const balances: HeldBalance[] = [{ asset: { code: 'USDC', issuer: AQUA_ISSUER }, balance: '1' }];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.heldSettlementAsset, '0');
  assert.equal(plan.conversions[0].routable, false);
  assert.match(plan.conversions[0].reason ?? '', /different asset from the settlement/);
});

test('a routable code held under the wrong issuer is not routable', async () => {
  const balances: HeldBalance[] = [
    { asset: { code: 'EURC', issuer: AQUA_ISSUER }, balance: '10' },
  ];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.conversions[0].routable, false);
  assert.match(plan.conversions[0].reason ?? '', /issuer is not the configured/);
});

test('a failed quote is recorded as not routable with the error', async () => {
  const balances: HeldBalance[] = [{ asset: { code: 'EURC', issuer: CIRCLE_EURC }, balance: '5' }];
  const plan = await planConversions(balances, USDC, async () => {
    throw new Error('No route found for EURC → USDC');
  });
  assert.equal(plan.conversions[0].routable, false);
  assert.match(plan.conversions[0].reason ?? '', /No route found/);
});

test('zero balances are skipped', async () => {
  const balances: HeldBalance[] = [{ asset: { code: 'EURC', issuer: CIRCLE_EURC }, balance: '0.0000000' }];
  const plan = await planConversions(balances, USDC, quoteOk);
  assert.equal(plan.conversions.length, 0);
});

test('projected settlement balance sums held plus every conversion floor', async () => {
  const balances: HeldBalance[] = [
    { asset: USDC, balance: '10.0000000' },
    { asset: { code: 'EURC', issuer: CIRCLE_EURC }, balance: '40' },
  ];
  const plan = await planConversions(balances, USDC, async () => fakeQuote('91', '90.5000000'));
  assert.equal(plan.projectedSettlementAsset, '100.5000000');
});

test('the conversion takes the DEX path that delivers the most settlement asset', () => {
  const best = bestStrictSendPath([
    { destination_amount: '9.5', path: [] },
    { destination_amount: '10.25', path: [{ asset_type: 'native' }] },
    { destination_amount: '0', path: [] },
  ]);
  assert.equal(best.destination_amount, '10.25');
  assert.throws(() => bestStrictSendPath([{ destination_amount: '0', path: [] }]), { name: 'NoRoute' });
});

test('the conversion pays the treasury itself, bounds slippage and expires within the hour', () => {
  const treasuryKey = Keypair.random().publicKey();
  const eurIssuer = Keypair.random().publicKey();
  const usdIssuer = Keypair.random().publicKey();
  const { tx, minOut, expiresAt } = buildConversionTx(
    new Account(treasuryKey, '41'),
    { code: 'EURC', issuer: eurIssuer },
    { code: 'USDC', issuer: usdIssuer },
    '100.0000000',
    { destination_amount: '108.0000000', path: [{ asset_type: 'native' }] },
    100,
    1_800_000_000,
  );
  assert.equal(tx.source, treasuryKey);
  assert.equal(tx.signatures.length, 0);
  assert.equal(tx.timeBounds?.maxTime, String(1_800_000_000 + 3600));
  assert.equal(expiresAt, new Date((1_800_000_000 + 3600) * 1000).toISOString());
  const [op] = tx.operations as unknown as Array<Record<string, unknown>>;
  assert.equal(op.type, 'pathPaymentStrictSend');
  assert.equal(op.destination, treasuryKey);
  assert.equal(op.sendAmount, '100.0000000');
  assert.equal(op.destMin, '106.9200000');
  assert.equal(minOut, 1_069_200_000n);
  assert.equal((op.path as unknown[]).length, 1);
});
