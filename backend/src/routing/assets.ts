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
  if (env.network !== 'testnet') {
    throw new Error('Cross-asset routing is testnet-only — mainnet pools are gated behind Phase 5');
  }
  if (!cache) {
    cache = new Map(env.routing.assets.map((ref) => [ref.code.toUpperCase(), build(ref)]));
  }
  return cache;
}

export function isRoutableSymbol(v: string): boolean {
  return registry().has(v.toUpperCase());
}

export function resolveAsset(symbol: string): RoutableAsset {
  const found = registry().get(symbol.toUpperCase());
  if (!found) {
    throw new Error(
      `Asset "${symbol}" is not routable — configured: ${[...registry().keys()].join(', ')}`,
    );
  }
  return found;
}

export function listRoutableAssets(): RoutableAsset[] {
  return [...registry().values()];
}
