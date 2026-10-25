import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutingProviderName } from '@pathpulse/contract';
import { rankQuotes, runQuote, runSwap } from './aggregator.js';
import type { ProviderQuote, RoutingProvider } from './provider.js';
import { routingError } from './provider.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeOpts {
  canQuote?: boolean;
  canExecute?: boolean;
  dest?: bigint;
  min?: bigint;
  quoteDelayMs?: number;
  quoteError?: Error;
  executeError?: Error;
}

function fake(name: RoutingProviderName, opts: FakeOpts = {}): RoutingProvider {
  return {
    name,
    canQuote: opts.canQuote ?? true,
    canExecute: opts.canExecute ?? true,
    async quote(from, to, sourceStroops): Promise<ProviderQuote> {
      if (opts.quoteDelayMs) await sleep(opts.quoteDelayMs);
      if (opts.quoteError) throw opts.quoteError;
      const dest = opts.dest ?? 100n;
      return {
        provider: name,
        from,
        to,
        sourceStroops,
        destinationStroops: dest,
        minDestinationStroops: opts.min ?? dest,
        hops: 1,
        pools: [`pool-${name}`],
        route: [from, to],
      };
    },
    async execute(from, to, sourceStroops) {
      if (opts.executeError) throw opts.executeError;
      return {
        id: `swp_${name}`,
        provider: name,
        createdAt: new Date().toISOString(),
        network: 'testnet',
        sourceAddress: 'GSOURCE',
        from: { code: from },
        to: { code: to },
        sourceAmount: '1',
        estimatedDestinationAmount: '1',
        minDestinationAmount: '1',
        hops: 1,
        pools: [],
        txHash: `hash_${name}`,
        horizonUrl: `https://x/${name}`,
      };
    },
  };
}

test('rankQuotes puts Aquarius first then orders by minDestinationStroops', () => {
  const q = (p: RoutingProviderName, min: bigint): ProviderQuote => ({
    provider: p,
    from: 'XLM',
    to: 'USDC',
    sourceStroops: 1n,
    destinationStroops: min,
    minDestinationStroops: min,
    hops: 0,
    pools: [],
    route: [],
  });
  const ranked = rankQuotes([q('stellarbroker', 110n), q('aquarius', 90n)]);
  assert.deepEqual(
    ranked.map((r) => r.provider),
    ['aquarius', 'stellarbroker'],
  );
});

test('runQuote prefers Aquarius and lists the rest as alternatives', async () => {
  const providers = [
    fake('aquarius', { dest: 90n, min: 88n }),
    fake('stellarbroker', { dest: 105n, min: 103n }),
  ];
  const quote = await runQuote(providers, 'XLM', 'USDC', '10');
  assert.equal(quote.provider, 'aquarius');
  assert.equal(quote.minDestinationAmount, '0.0000088');
  assert.equal(quote.alternatives?.length, 1);
  assert.equal(quote.alternatives?.[0].provider, 'stellarbroker');
});

test('runQuote with one provider has no alternatives', async () => {
  const quote = await runQuote([fake('aquarius', { dest: 90n })], 'XLM', 'USDC', '10');
  assert.equal(quote.provider, 'aquarius');
  assert.equal(quote.alternatives, undefined);
});

test('runQuote survives one provider failing', async () => {
  const providers = [
    fake('aquarius', { quoteError: routingError('aqua down', 502, 'RoutingUnavailable') }),
    fake('stellarbroker', { dest: 100n }),
  ];
  const quote = await runQuote(providers, 'XLM', 'USDC', '10');
  assert.equal(quote.provider, 'stellarbroker');
});

test('runQuote throws NoRoute when every provider fails', async () => {
  const providers = [
    fake('aquarius', { quoteError: new Error('no path') }),
    fake('stellarbroker', { quoteError: new Error('unfeasible') }),
  ];
  await assert.rejects(runQuote(providers, 'XLM', 'USDC', '10'), (e: Error & { status?: number }) => {
    assert.equal(e.name, 'NoRoute');
    assert.equal(e.status, 422);
    return true;
  });
});

test('runQuote excludes a provider that exceeds the quote timeout', async () => {
  const providers = [
    fake('aquarius', { dest: 200n, quoteDelayMs: 200 }),
    fake('stellarbroker', { dest: 100n }),
  ];
  const quote = await runQuote(providers, 'XLM', 'USDC', '10', 50);
  assert.equal(quote.provider, 'stellarbroker');
});

test('runQuote rejects an unsupported pair before hitting providers', async () => {
  await assert.rejects(runQuote([fake('aquarius')], 'XLM', 'DOGE', '10'), /Unsupported routing pair/);
});

test('runQuote rejects identical from/to', async () => {
  await assert.rejects(runQuote([fake('aquarius')], 'XLM', 'XLM', '10'), /must be different assets/);
});

test('runSwap executes through Aquarius when it can', async () => {
  const providers = [
    fake('aquarius', { dest: 90n }),
    fake('stellarbroker', { dest: 110n }),
  ];
  const result = await runSwap(providers, 'XLM', 'USDC', '10');
  assert.equal(result.provider, 'aquarius');
  assert.equal(result.txHash, 'hash_aquarius');
});

test('runSwap uses StellarBroker when Aquarius cannot execute', async () => {
  const providers = [
    fake('aquarius', { dest: 90n, canExecute: false }),
    fake('stellarbroker', { dest: 110n }),
  ];
  const result = await runSwap(providers, 'XLM', 'USDC', '10');
  assert.equal(result.provider, 'stellarbroker');
});

test('runSwap never falls back when the chosen provider fails on execute', async () => {
  let brokerExecuted = false;
  const broker = fake('stellarbroker', { dest: 110n });
  const original = broker.execute.bind(broker);
  broker.execute = async (...args) => {
    brokerExecuted = true;
    return original(...args);
  };
  const providers = [
    fake('aquarius', { dest: 90n, executeError: routingError('sim failed', 422, 'SorobanFailed') }),
    broker,
  ];
  await assert.rejects(runSwap(providers, 'XLM', 'USDC', '10'), /sim failed/);
  assert.equal(brokerExecuted, false);
});

test('runSwap throws RoutingUnavailable when no provider can execute', async () => {
  const providers = [fake('aquarius', { dest: 110n, canExecute: false })];
  await assert.rejects(runSwap(providers, 'XLM', 'USDC', '10'), (e: Error & { status?: number }) => {
    assert.equal(e.status, 502);
    return true;
  });
});

test('runSwap pinned to StellarBroker executes there even when Aquarius quotes better', async () => {
  const providers = [fake('aquarius', { dest: 120n }), fake('stellarbroker', { dest: 100n })];
  const result = await runSwap(providers, 'XLM', 'USDC', '10', undefined, 'stellarbroker');
  assert.equal(result.provider, 'stellarbroker');
});

test('runSwap pinned to a provider never falls back to another venue', async () => {
  const providers = [
    fake('aquarius', { dest: 120n }),
    fake('stellarbroker', { quoteError: routingError('no route', 422, 'NoRoute') }),
  ];
  await assert.rejects(runSwap(providers, 'XLM', 'USDC', '10', undefined, 'stellarbroker'));
});

test('runSwap pinned to a provider that cannot execute is refused before quoting', async () => {
  const providers = [fake('aquarius', { dest: 120n }), fake('stellarbroker', { canExecute: false })];
  await assert.rejects(runSwap(providers, 'XLM', 'USDC', '10', undefined, 'stellarbroker'), /not able to execute/);
});
