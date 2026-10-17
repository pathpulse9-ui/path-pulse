import { randomUUID } from 'node:crypto';
import type { ManagedWallet } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { provisionManagedWallet } from '../stellar/managed.js';

function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed.includes('@')) throw new Error('invalid email');
  return trimmed;
}

function accountError(message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = 'AccountMismatch';
  e.status = 401;
  return e;
}

async function userIdForEmail(email: string, sub: string): Promise<string> {
  await db().query(
    'insert into users (email, user_id, google_sub) values ($1, $2, $3) on conflict (email) do nothing',
    [email, randomUUID(), sub],
  );
  const row = await db().query<{ user_id: string; google_sub: string | null }>(
    'select user_id, google_sub from users where email = $1',
    [email],
  );
  const user = row.rows[0];
  if (!user) throw new Error(`Failed to create account for ${email}`);
  if (user.google_sub === null) {
    await db().query('update users set google_sub = $2 where email = $1 and google_sub is null', [email, sub]);
  } else if (user.google_sub !== sub) {
    throw accountError('This email is bound to a different Google account');
  }
  return user.user_id;
}

export async function ensureAccountForEmail(
  email: string,
  sub: string,
): Promise<{ userId: string; wallet: ManagedWallet }> {
  const userId = await userIdForEmail(normalizeEmail(email), sub);
  return { userId, wallet: await provisionManagedWallet(userId) };
}
