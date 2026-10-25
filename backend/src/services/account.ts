import { randomUUID } from 'node:crypto';
import type { ManagedWallet } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { ensureManagedWalletKey } from '../stellar/managed.js';

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

export async function userIdForEmail(email: string, sub: string): Promise<string> {
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
  if (user.google_sub === sub) return user.user_id;
  if (user.google_sub === null) {
    const bound = await db().query<{ google_sub: string }>(
      'update users set google_sub = $2 where email = $1 and google_sub is null returning google_sub',
      [email, sub],
    );
    if (bound.rowCount === 1) return user.user_id;
    const current = await db().query<{ google_sub: string | null }>('select google_sub from users where email = $1', [email]);
    if (current.rows[0]?.google_sub === sub) return user.user_id;
  }
  throw accountError('This email is bound to a different Google account');
}

export async function ensureAccountForEmail(
  email: string,
  sub: string,
): Promise<{ userId: string; wallet: ManagedWallet }> {
  const userId = await userIdForEmail(normalizeEmail(email), sub);
  return { userId, wallet: await ensureManagedWalletKey(userId) };
}
