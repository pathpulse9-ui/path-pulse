import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

/**
 * Per-driver Carret sub-account store (PAT-75).
 *
 * Every PathPulse `userId` maps 1:1 to a Carret sub-account. The mapping is
 * created lazily on first KYC / off-ramp interaction: `getOrProvision` returns
 * the existing account_id if one is on file, otherwise creates a new Carret
 * sub-account and persists the mapping in one call.
 *
 * With DATABASE_URL unset (local dev without Docker) the store falls back to
 * an in-memory Map so every existing dev flow keeps working.
 */

export interface CarretMapping {
  userId: string;
  carretAccountId: string;
  referenceId?: string;
  kycStatus: 'pending' | 'verified' | 'rejected' | 'manual_review';
  walletWhitelistedAt?: string;
  /**
   * Email the sub-account was registered with on Carret. Optional for
   * backwards-compat with rows written before this column existed.
   * Used by `getMappingByEmail` to resume a KYC application across a
   * new browser / phone / guest cookie (i.e. when the userId changes
   * but the driver returns with the same email).
   */
  email?: string;
  /**
   * Phone the sub-account was registered with on Carret. Same purpose
   * as `email` above — Carret rejects duplicates on BOTH fields (the
   * phone becomes their `username`), so we need to be able to resume
   * on either.
   */
  phone?: string;
}

const memoryStore = new Map<string, CarretMapping>();

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
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

/**
 * Look up an existing sub-account by the email it was registered with.
 * Powers cross-session resume: a driver comes back on a new install /
 * browser (fresh guest cookie) with the same email — we adopt the
 * existing Carret account into their new session's mapping instead of
 * hitting Carret's duplicate-email 4xx.
 */
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

/**
 * Look up by phone number (bare 10 digits). Carret rejects duplicate
 * phones with a `username already exists` error just as it does for
 * email, so we need this second index to complete the cross-session
 * adopt path.
 */
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

/** Upsert the mapping. Returns the mapping after write. */
export async function upsertMapping(m: CarretMapping): Promise<CarretMapping> {
  if (!hasDb()) {
    memoryStore.set(m.userId, m);
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

/**
 * Delete the mapping row for a session's userId. Called by the wizard's
 * "Start fresh" so a subsequent `provision-subaccount` doesn't silently
 * return the stale row (which would ignore whatever new email/phone the
 * driver just typed and adopt them back into the old Carret account).
 */
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
