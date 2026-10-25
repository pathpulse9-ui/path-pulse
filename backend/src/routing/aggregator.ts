import type { RoutingProviderName, RoutingQuote, RoutingSwapResult } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { resolveAsset, isRoutableSymbol, type RoutableSymbol } from './assets.js';
import { routingError, type ProviderQuote, type RoutingProvider } from './provider.js';
import { aquariusProvider } from './aquarius-provider.js';
import { stellarBrokerProvider } from './stellarbroker-provider.js';

function activeProviders(): RoutingProvider[] {
  return [aquariusProvider, stellarBrokerProvider];
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const error = routingError(`${label} quote timed out after ${ms}ms`, 504, 'RoutingTimeout');
      controller.abort(error);
      reject(error);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([run(controller.signal).finally(() => clearTimeout(timer)), timeout]);
}

export function rankQuotes(quotes: ProviderQuote[]): ProviderQuote[] {
  return [...quotes].sort((a, b) => {
    if (a.provider !== b.provider) {
      if (a.provider === 'aquarius') return -1;
      if (b.provider === 'aquarius') return 1;
    }
    if (a.minDestinationStroops === b.minDestinationStroops) return 0;
    return a.minDestinationStroops < b.minDestinationStroops ? 1 : -1;
  });
}

async function gatherQuotes(
  providers: RoutingProvider[],
  from: RoutableSymbol,
  to: RoutableSymbol,
  sourceStroops: bigint,
  timeoutMs: number,
): Promise<ProviderQuote[]> {
  const quoting = providers.filter((p) => p.canQuote);
  if (!quoting.length) {
    throw routingError('No routing providers can produce a quote', 500, 'ConfigError');
  }
  const settled = await Promise.allSettled(
    quoting.map((p) => withTimeout((signal) => p.quote(from, to, sourceStroops, signal), timeoutMs, p.name)),
  );
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<ProviderQuote> => s.status === 'fulfilled')
    .map((s) => s.value);
  if (!ok.length) {
    const reasons = settled
      .map((s) => (s.status === 'rejected' ? String((s.reason as Error)?.message ?? s.reason) : ''))
      .filter(Boolean);
    logger.info({ from, to, reasons }, 'no routing provider produced a quote');
    throw routingError(`No route found for ${from} → ${to}`, 422, 'NoRoute');
  }
  return rankQuotes(ok);
}

function toRoutingQuote(q: ProviderQuote): RoutingQuote {
  return {
    provider: q.provider,
    from: resolveAsset(q.from).ref,
    to: resolveAsset(q.to).ref,
    sourceAmount: fromStroops(q.sourceStroops),
    destinationAmount: fromStroops(q.destinationStroops),
    minDestinationAmount: fromStroops(q.minDestinationStroops),
    slippageBps: env.routing.slippageBps,
    hops: q.hops,
    pools: q.pools,
    route: q.route,
  };
}

function validatePair(from: string, to: string): [RoutableSymbol, RoutableSymbol] {
  if (!isRoutableSymbol(from) || !isRoutableSymbol(to)) {
    throw routingError(`Unsupported routing pair ${from} → ${to}`, 400, 'ValidationError');
  }
  if (from.toUpperCase() === to.toUpperCase()) {
    throw routingError('from and to must be different assets', 400, 'ValidationError');
  }
  return [from, to];
}

export async function runQuote(
  providers: RoutingProvider[],
  from: string,
  to: string,
  amount: string,
  timeoutMs: number = env.routing.quoteTimeoutMs,
): Promise<RoutingQuote> {
  const [f, t] = validatePair(from, to);
  const ranked = await gatherQuotes(providers, f, t, toStroops(amount), timeoutMs);
  const [best, ...rest] = ranked;
  const quote = toRoutingQuote(best);
  if (rest.length) quote.alternatives = rest.map(toRoutingQuote);
  return quote;
}

export async function runSwap(
  providers: RoutingProvider[],
  from: string,
  to: string,
  amount: string,
  timeoutMs: number = env.routing.quoteTimeoutMs,
  only?: RoutingProviderName,
): Promise<RoutingSwapResult> {
  const [f, t] = validatePair(from, to);
  const sourceStroops = toStroops(amount);
  const pool = only ? providers.filter((p) => p.name === only) : providers;
  if (only && !pool[0]?.canExecute) {
    throw routingError(`${only} is not able to execute swaps here`, 422, 'RoutingUnavailable');
  }
  const ranked = await gatherQuotes(pool, f, t, sourceStroops, timeoutMs);
  const byName = new Map(pool.map((p) => [p.name, p]));

  const best = ranked.find((q) => byName.get(q.provider)?.canExecute);
  const provider = best && byName.get(best.provider);
  if (!provider) {
    throw routingError('No routing provider is able to execute swaps', 502, 'RoutingUnavailable');
  }
  return provider.execute(f, t, sourceStroops);
}

export function quoteSwap(from: string, to: string, amount: string): Promise<RoutingQuote> {
  return runQuote(activeProviders(), from, to, amount);
}

export function executeSwap(
  from: string,
  to: string,
  amount: string,
  only?: RoutingProviderName,
): Promise<RoutingSwapResult> {
  return runSwap(activeProviders(), from, to, amount, undefined, only);
}
