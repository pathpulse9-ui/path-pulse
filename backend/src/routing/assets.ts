import { Asset } from '@stellar/stellar-sdk';
import type { AssetRef } from '@pathpulse/contract';
import { env } from '../config/env.js';

export type RoutableSymbol = string;

export interface RoutableAsset {
  symbol: string;
  ref: AssetRef;
  asset: Asset;
  contractId: string;
}

function build(ref: AssetRef): RoutableAsset {
  const asset = ref.issuer ? new Asset(ref.code, ref.issuer) : Asset.native();
  return {
    symbol: ref.code.toUpperCase(),
    ref: ref.issuer ? { code: ref.code, issuer: ref.issuer } : { code: ref.code },
    asset,
    contractId: asset.contractId(env.networkPassphrase),
  };
}

let cache: Map<string, RoutableAsset> | null = null;

function registry(): Map<string, RoutableAsset> {
  if (!cache) {
    const built = new Map<string, RoutableAsset>();
    for (const ref of env.routing.assets) {
      const symbol = ref.code.toUpperCase();
      if (built.has(symbol)) throw new Error(`ROUTING_ASSETS lists ${symbol} more than once`);
      built.set(symbol, build(ref));
    }
    cache = built;
  }
  return cache;
}

export function isRoutableSymbol(v: string): boolean {
  return registry().has(v.toUpperCase());
}

export function resolveAsset(symbol: string): RoutableAsset {
  const found = registry().get(symbol.toUpperCase());
  if (!found) {
    throw new Error(`Asset "${symbol}" is not routable`);
  }
  return found;
}

export function listRoutableAssets(): RoutableAsset[] {
  return [...registry().values()];
}
