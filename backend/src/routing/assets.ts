import { Asset } from '@stellar/stellar-sdk';
import type { AssetRef } from '@pathpulse/contract';
import { env } from '../config/env.js';

export type RoutableSymbol = 'XLM' | 'USDC';

export interface RoutableAsset {
  symbol: RoutableSymbol;
  ref: AssetRef;
  asset: Asset;
  contractId: string;
}

const TESTNET_USDC_ISSUER = 'GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER';

function build(symbol: RoutableSymbol, ref: AssetRef): RoutableAsset {
  const asset = ref.issuer ? new Asset(ref.code, ref.issuer) : Asset.native();
  return { symbol, ref, asset, contractId: asset.contractId(env.networkPassphrase) };
}

let cache: Record<RoutableSymbol, RoutableAsset> | null = null;

function registry(): Record<RoutableSymbol, RoutableAsset> {
  if (env.network !== 'testnet') {
    throw new Error('Aquarius routing is testnet-only — mainnet pools are gated behind Phase 5');
  }
  if (!cache) {
    cache = {
      XLM: build('XLM', { code: 'XLM' }),
      USDC: build('USDC', { code: 'USDC', issuer: TESTNET_USDC_ISSUER }),
    };
  }
  return cache;
}

export const ROUTABLE_SYMBOLS: RoutableSymbol[] = ['XLM', 'USDC'];

export function isRoutableSymbol(v: string): v is RoutableSymbol {
  return (ROUTABLE_SYMBOLS as string[]).includes(v);
}

export function resolveAsset(symbol: RoutableSymbol): RoutableAsset {
  return registry()[symbol];
}

export function listRoutableAssets(): RoutableAsset[] {
  return ROUTABLE_SYMBOLS.map((s) => registry()[s]);
}
