import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { ManagedWallet } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { fundWithFriendbot } from '../stellar/network.js';

interface Account {
  userId: string;
  email: string;
  keypair: Keypair;
}

const accountsByEmail = new Map<string, Account>();

function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed.includes('@')) throw new Error('invalid email');
  return trimmed;
}

export async function ensureAccountForEmail(
  email: string,
): Promise<{ userId: string; wallet: ManagedWallet }> {
  const normalized = normalizeEmail(email);
  let account = accountsByEmail.get(normalized);
  if (!account) {
    const keypair = Keypair.random();
    account = { userId: randomUUID(), email: normalized, keypair };
    accountsByEmail.set(normalized, account);
    if (env.network === 'testnet') {
      await fundWithFriendbot(keypair.publicKey()).catch(() => undefined);
    }
  }
  return {
    userId: account.userId,
    wallet: {
      userId: account.userId,
      address: account.keypair.publicKey(),
      provisioned: true,
      network: env.network,
    },
  };
}
