import { randomUUID } from 'node:crypto';
import type { ManagedWallet } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { provisionManagedWallet } from '../stellar/managed.js';

function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed.includes('@')) throw new Error('invalid email');
  return trimmed;
}

async function userIdForEmail(email: string): Promise<string> {
  const existing = await db().query<{ user_id: string }>(
    'select user_id from users where email = $1',
    [email],
  );
  if (existing.rows[0]) return existing.rows[0].user_id;

  await db().query('insert into users (email, user_id) values ($1, $2) on conflict (email) do nothing', [
    email,
    randomUUID(),
  ]);
  const row = await db().query<{ user_id: string }>('select user_id from users where email = $1', [
    email,
  ]);
  if (!row.rows[0]) throw new Error(`Failed to create account for ${email}`);
  return row.rows[0].user_id;
}

export async function ensureAccountForEmail(
  email: string,
): Promise<{ userId: string; wallet: ManagedWallet }> {
  const userId = await userIdForEmail(normalizeEmail(email));
  return { userId, wallet: await provisionManagedWallet(userId) };
}
