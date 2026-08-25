import { randomUUID } from 'node:crypto';
import type { ManagedWallet } from '@pathpulse/contract';
import { provisionManagedWallet } from '../stellar/managed.js';

const userIdsByEmail = new Map<string, string>();

function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed.includes('@')) throw new Error('invalid email');
  return trimmed;
}

export async function ensureAccountForEmail(
  email: string,
): Promise<{ userId: string; wallet: ManagedWallet }> {
  const normalized = normalizeEmail(email);
  let userId = userIdsByEmail.get(normalized);
  if (!userId) {
    userId = randomUUID();
    userIdsByEmail.set(normalized, userId);
  }
  return { userId, wallet: await provisionManagedWallet(userId) };
}
