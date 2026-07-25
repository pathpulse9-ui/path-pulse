import { env } from '../config/env.js';
import type { ManagedWallet } from '@pathpulse/contract';

/**
 * Privy server-side integration (D1).
 *
 * Flow: the mobile/web client signs the user up via the Privy SDK (email/OAuth),
 * receives a Privy access token, and sends it here. The backend verifies the
 * token against Privy, then ensures the user has an embedded Stellar wallet.
 *
 * Phase 1 ships a verifiable stub with the correct interface so clients can build
 * against it immediately; the live Privy REST calls are wired once PRIVY_APP_ID /
 * PRIVY_APP_SECRET are provisioned (Week 1 task).
 */

export interface PrivyUser {
  userId: string;
  email?: string;
}

export async function verifyPrivyToken(token: string): Promise<PrivyUser> {
  if (!token) throw new Error('missing privy token');
  if (!env.privy.appId || !env.privy.appSecret) {
    // Dev stub: derive a stable pseudo-user id from the token until Privy creds land.
    const userId = `dev-${Buffer.from(token).toString('hex').slice(0, 16)}`;
    return { userId };
  }
  // TODO(phase1): call Privy verification endpoint with app credentials.
  throw new Error('Privy live verification not yet wired — set PRIVY creds or use dev stub');
}

/**
 * Ensure the user has an embedded Stellar wallet provisioned via Privy.
 * Returns the managed wallet descriptor.
 */
export async function ensureManagedWallet(user: PrivyUser): Promise<ManagedWallet> {
  // TODO(phase1): call Privy embedded-wallet provisioning; persist mapping in Postgres.
  // Stub returns an unprovisioned placeholder so the contract shape is exercised end-to-end.
  return {
    userId: user.userId,
    address: '',
    provisioned: false,
    network: env.network,
  };
}
