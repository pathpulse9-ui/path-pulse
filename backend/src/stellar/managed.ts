import { Keypair } from '@stellar/stellar-sdk';
import type { ManagedWallet } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { fundWithFriendbot, accountExists } from './network.js';
import { DevSigner, type Signer } from './signing.js';
import { logger } from '../config/logger.js';

/**
 * Custodial managed wallets. The backend generates and holds the key; this is not
 * self-custody. Secrets live in process memory only and do not survive a restart.
 * Testnet only — see docs/CUSTODY.md.
 */

interface ManagedRecord {
  keypair: Keypair;
  provisioned: boolean;
}

const store = new Map<string, ManagedRecord>();

function toWallet(userId: string, rec: ManagedRecord): ManagedWallet {
  return {
    userId,
    address: rec.keypair.publicKey(),
    provisioned: rec.provisioned,
    network: env.network,
  };
}

export async function provisionManagedWallet(userId: string): Promise<ManagedWallet> {
  if (env.network !== 'testnet') {
    throw new Error('Managed wallet provisioning is testnet-only');
  }
  let rec = store.get(userId);
  if (!rec) {
    rec = { keypair: Keypair.random(), provisioned: false };
    store.set(userId, rec);
  }
  if (!rec.provisioned && !(await accountExists(rec.keypair.publicKey()))) {
    await fundWithFriendbot(rec.keypair.publicKey());
    logger.info({ userId, address: rec.keypair.publicKey() }, 'provisioned dev managed wallet');
  }
  rec.provisioned = true;
  return toWallet(userId, rec);
}

export function getManagedWallet(userId: string): ManagedWallet | null {
  const rec = store.get(userId);
  return rec ? toWallet(userId, rec) : null;
}

/** Signer for a provisioned managed wallet (dev tier — refuses mainnet via DevSigner). */
export function getManagedSigner(userId: string): Signer {
  const rec = store.get(userId);
  if (!rec) throw new Error(`No managed wallet for user ${userId} — sign in first`);
  return new DevSigner(rec.keypair.secret());
}
