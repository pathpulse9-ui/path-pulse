import { Horizon, type FeeBumpTransaction, type Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { assertMainnetAllowed } from './networkGuard.js';

export const horizon = new Horizon.Server(env.horizonUrl, {
  allowHttp: env.horizonUrl.startsWith('http://'),
});

export async function fundWithFriendbot(publicKey: string): Promise<void> {
  if (env.network !== 'testnet') {
    throw new Error('Friendbot funding is testnet-only');
  }
  const res = await fetch(`${env.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error(`Friendbot funding failed (${res.status}): ${await res.text()}`);
  }
}

export async function submitToHorizon(tx: Transaction | FeeBumpTransaction, context: string) {
  assertMainnetAllowed(context);
  return horizon.submitTransaction(tx);
}

export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await horizon.loadAccount(publicKey);
    return true;
  } catch (e: any) {
    if (e?.response?.status === 404) return false;
    throw e;
  }
}
