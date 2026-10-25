import { env } from '../config/env.js';

export function assertMemoryFallbackAllowed(store: string, network: string = env.network): void {
  if (network === 'mainnet') {
    throw new Error(`${store} requires the database on mainnet; refusing the in-memory fallback`);
  }
}

export function databaseOrMemory(store: string): boolean {
  if (env.databaseUrl) return true;
  assertMemoryFallbackAllowed(store);
  return false;
}
