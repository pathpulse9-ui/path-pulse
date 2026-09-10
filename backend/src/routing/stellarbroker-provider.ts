import { estimateSwap, type QuoteParams } from '@stellar-broker/client';
import { env } from '../config/env.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';
import { routingError, type ProviderQuote, type RoutingProvider } from './provider.js';

function brokerAsset(symbol: RoutableSymbol): string {
  const { ref } = resolveAsset(symbol);
  return ref.issuer ? `${ref.code}-${ref.issuer}` : 'XLM';
}

function applySlippage(stroops: bigint): bigint {
  const bps = BigInt(env.routing.slippageBps);
  return (stroops * (10_000n - bps)) / 10_000n;
}

export const stellarBrokerProvider: RoutingProvider = {
  name: 'stellarbroker',
  canQuote: true,
  canExecute: false,

  async quote(from, to, sourceStroops): Promise<ProviderQuote> {
    const params = {
      sellingAsset: brokerAsset(from),
      buyingAsset: brokerAsset(to),
      sellingAmount: fromStroops(sourceStroops),
      slippageTolerance: env.routing.slippageBps / 10_000,
      origin: env.routing.stellarBroker.apiUrl,
    } as QuoteParams;

    let result;
    try {
      result = await estimateSwap(params);
    } catch (e) {
      const code = (e as { code?: number }).code;
      throw routingError(
        `StellarBroker quote failed: ${(e as Error).message ?? String(e)}`,
        code ? 422 : 502,
        code ? 'NoRoute' : 'RoutingUnavailable',
      );
    }

    if (result.status !== 'success' || !result.estimatedBuyingAmount) {
      throw routingError(`StellarBroker: no route for ${from} → ${to} (${result.status})`, 422, 'NoRoute');
    }

    const destinationStroops = toStroops(result.estimatedBuyingAmount);
    const route = result.directTrade?.path ?? [];
    return {
      provider: 'stellarbroker',
      from,
      to,
      sourceStroops,
      destinationStroops,
      minDestinationStroops: applySlippage(destinationStroops),
      hops: route.length,
      pools: [],
      route,
    };
  },

  async execute() {
    throw routingError(
      'StellarBroker execution is not wired yet — needs an interactive session (partnerKey + confirmQuote/mediator flow)',
      501,
      'NotImplemented',
    );
  },
};
