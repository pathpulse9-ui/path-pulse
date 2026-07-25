import { Horizon } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';

/** Shared Horizon server instance for the configured network. */
export const horizon = new Horizon.Server(env.horizonUrl, {
  allowHttp: env.horizonUrl.startsWith('http://'),
});

/** Fund a testnet account via Friendbot. Refuses to run on mainnet. */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  if (env.network !== 'testnet') {
    throw new Error('Friendbot funding is testnet-only');
  }
  const res = await fetch(`${env.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error(`Friendbot funding failed (${res.status}): ${await res.text()}`);
  }
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
