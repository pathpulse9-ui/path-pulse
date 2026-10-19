import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';
import { evictOldest } from '../util/bounded.js';
import { databaseOrMemory } from '../util/memoryFallback.js';

export interface CarretMapping {
  userId: string;
  carretAccountId: string;
  referenceId?: string;
  kycStatus: 'pending' | 'verified' | 'rejected' | 'manual_review';
  walletWhitelistedAt?: string;
  email?: string;
  phone?: string;
}

const memoryStore = new Map<string, CarretMapping>();

function hasDb(): boolean {
  return databaseOrMemory('Carret account store');
}

function rowToMapping(r: Record<string, unknown>): CarretMapping {
  return {
    userId: r.user_id as string,
    carretAccountId: r.carret_account_id as string,
    referenceId: (r.reference_id as string | null) ?? undefined,
    kycStatus: r.kyc_status as CarretMapping['kycStatus'],
    walletWhitelistedAt: (r.wallet_whitelisted_at as Date | null)?.toISOString(),
    email: (r.email as string | null) ?? undefined,
    phone: (r.phone as string | null) ?? undefined,
  };
}

export async function getMapping(userId: string): Promise<CarretMapping | null> {
  if (!hasDb()) return memoryStore.get(userId) ?? null;
  const res = await db().query(
    'select user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at, email, phone from carret_subaccounts where user_id = $1',
    [userId],
  );
  const r = res.rows[0];
  return r ? rowToMapping(r) : null;
}

export async function getMappingByEmail(email: string): Promise<CarretMapping | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  if (!hasDb()) {
    for (const m of memoryStore.values()) {
      if (m.email && m.email.toLowerCase() === needle) return m;
    }
    return null;
  }
  const res = await db().query(
    'select user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at, email, phone from carret_subaccounts where lower(email) = $1 limit 1',
    [needle],
  );
  const r = res.rows[0];
  return r ? rowToMapping(r) : null;
}

export async function getMappingByPhone(phone: string): Promise<CarretMapping | null> {
  const needle = phone.replace(/\D/g, '');
  if (!needle) return null;
  if (!hasDb()) {
    for (const m of memoryStore.values()) {
      if (m.phone && m.phone.replace(/\D/g, '') === needle) return m;
    }
    return null;
  }
  const res = await db().query(
    'select user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at, email, phone from carret_subaccounts where phone = $1 limit 1',
    [needle],
  );
  const r = res.rows[0];
  return r ? rowToMapping(r) : null;
}

export async function upsertMapping(m: CarretMapping): Promise<CarretMapping> {
  if (!hasDb()) {
    memoryStore.set(m.userId, m);
    evictOldest(memoryStore, 5_000);
    return m;
  }
  await db().query(
    `insert into carret_subaccounts
       (user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at, email, phone, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (user_id) do update set
       carret_account_id     = excluded.carret_account_id,
       reference_id          = excluded.reference_id,
       kyc_status            = excluded.kyc_status,
       wallet_whitelisted_at = coalesce(carret_subaccounts.wallet_whitelisted_at, excluded.wallet_whitelisted_at),
       email                 = coalesce(excluded.email, carret_subaccounts.email),
       phone                 = coalesce(excluded.phone, carret_subaccounts.phone),
       updated_at            = now()`,
    [
      m.userId, m.carretAccountId, m.referenceId ?? null, m.kycStatus,
      m.walletWhitelistedAt ?? null,
      m.email?.trim().toLowerCase() ?? null,
      m.phone?.replace(/\D/g, '') || null,
    ],
  );
  return m;
}

export async function deleteMapping(userId: string): Promise<void> {
  if (!hasDb()) { memoryStore.delete(userId); return; }
  await db().query('delete from carret_subaccounts where user_id = $1', [userId]);
}

export async function markWalletWhitelisted(userId: string): Promise<void> {
  const now = new Date().toISOString();
  if (!hasDb()) {
    const m = memoryStore.get(userId);
    if (m) memoryStore.set(userId, { ...m, walletWhitelistedAt: now });
    return;
  }
  await db().query(
    'update carret_subaccounts set wallet_whitelisted_at = now(), updated_at = now() where user_id = $1',
    [userId],
  );
}

export async function updateKycStatus(
  userId: string,
  kycStatus: CarretMapping['kycStatus'],
): Promise<void> {
  if (!hasDb()) {
    const m = memoryStore.get(userId);
    if (m) memoryStore.set(userId, { ...m, kycStatus });
    return;
  }
  await db().query(
    'update carret_subaccounts set kyc_status = $2, updated_at = now() where user_id = $1',
    [userId, kycStatus],
  );
  logger.info({ userId, kycStatus }, 'carret kyc status updated');
}
