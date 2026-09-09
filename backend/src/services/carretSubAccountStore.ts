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
}

const memoryStore = new Map<string, CarretMapping>();

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
}

export async function getMapping(userId: string): Promise<CarretMapping | null> {
  if (!hasDb()) return memoryStore.get(userId) ?? null;
  const res = await db().query(
    'select user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at from carret_subaccounts where user_id = $1',
    [userId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    userId: r.user_id,
    carretAccountId: r.carret_account_id,
    referenceId: r.reference_id ?? undefined,
    kycStatus: r.kyc_status,
    walletWhitelistedAt: r.wallet_whitelisted_at?.toISOString(),
  };
}

/** Upsert the mapping. Returns the mapping after write. */
export async function upsertMapping(m: CarretMapping): Promise<CarretMapping> {
  if (!hasDb()) {
    memoryStore.set(m.userId, m);
    return m;
  }
  await db().query(
    `insert into carret_subaccounts
       (user_id, carret_account_id, reference_id, kyc_status, wallet_whitelisted_at, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id) do update set
       carret_account_id     = excluded.carret_account_id,
       reference_id          = excluded.reference_id,
       kyc_status            = excluded.kyc_status,
       wallet_whitelisted_at = coalesce(carret_subaccounts.wallet_whitelisted_at, excluded.wallet_whitelisted_at),
       updated_at            = now()`,
    [m.userId, m.carretAccountId, m.referenceId ?? null, m.kycStatus, m.walletWhitelistedAt ?? null],
  );
  return m;
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
