import type { RoutingProviderName, RoutingSwapResult } from '@pathpulse/contract';
import type { RoutableSymbol } from './assets.js';

export type { RoutingProviderName };

export interface ProviderQuote {
  provider: RoutingProviderName;
  from: RoutableSymbol;
  to: RoutableSymbol;
  sourceStroops: bigint;
  destinationStroops: bigint;
  minDestinationStroops: bigint;
  hops: number;
  pools: string[];
  route: string[];
}

export interface RoutingProvider {
  readonly name: RoutingProviderName;
  readonly canQuote: boolean;
  readonly canExecute: boolean;
  quote(from: RoutableSymbol, to: RoutableSymbol, sourceStroops: bigint): Promise<ProviderQuote>;
  execute(from: RoutableSymbol, to: RoutableSymbol, sourceStroops: bigint): Promise<RoutingSwapResult>;
}

export function routingError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}
