import { Asset, Keypair } from '@stellar/stellar-sdk';
import type { ManagedWallet } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { keyFromEnv, seal, unseal } from '../crypto/seal.js';
import { fundWithFriendbot, accountExists } from './network.js';
import { CustodialSigner, createSigner, type Signer } from './signing.js';
import { createSponsoredAccount, type ReserveSponsor } from './sponsorship.js';
import { logger } from '../config/logger.js';

/**
 * Custodial managed wallets. The backend generates and holds the key; this is not
 * self-custody. Seeds are sealed with AES-256-GCM under KEY_ENCRYPTION_KEY and stored
 * in Postgres; the plaintext seed exists only inside this module and only long enough
 * to build a Keypair.
 */

interface WalletRow {
  user_id: string;
  public_key: string;
  sealed_seed: string;
  provisioned: boolean;
  network: string;
}

let cachedKey: Buffer | null = null;

/**
 * Root of trust for driver-seed encryption. With KEY_ENCRYPTION_KEY_CIPHERTEXT set, the KEK is
 * unwrapped once via KMS and never leaves this module; otherwise it comes from the environment.
 */
async function encryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  if (env.keyEncryptionKeyCiphertext) {
    const { awsKmsDecryptClient } = await import('./kms.js');
    const plaintext = await awsKmsDecryptClient().decrypt(
      Buffer.from(env.keyEncryptionKeyCiphertext, 'base64'),
    );
    cachedKey = keyFromEnv(Buffer.from(plaintext).toString('base64'));
    return cachedKey;
  }
  if (env.network === 'mainnet') {
    throw new Error('KEY_ENCRYPTION_KEY_CIPHERTEXT is required on mainnet — a plaintext KEK cannot seal mainnet seeds');
  }
  if (!env.keyEncryptionKey) {
    throw new Error('KEY_ENCRYPTION_KEY is not set — managed wallet seeds cannot be sealed');
  }
  cachedKey = keyFromEnv(env.keyEncryptionKey);
  return cachedKey;
}

function toWallet(row: WalletRow): ManagedWallet {
  return {
    userId: row.user_id,
    address: row.public_key,
    provisioned: row.provisioned,
    network: env.network,
  };
}

async function findRow(userId: string): Promise<WalletRow | null> {
  const r = await db().query<WalletRow>(
    'select user_id, public_key, sealed_seed, provisioned, network from managed_wallets where user_id = $1',
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.network !== env.network) {
    throw new Error(
      `Managed wallet for ${userId} belongs to ${row.network}, but STELLAR_NETWORK=${env.network}`,
    );
  }
  return row;
}

async function insertRow(userId: string): Promise<WalletRow> {
  const kp = Keypair.random();
  await db().query(
    `insert into managed_wallets (user_id, public_key, sealed_seed, provisioned, network)
     values ($1, $2, $3, false, $4)
     on conflict (user_id) do nothing`,
    [userId, kp.publicKey(), seal(kp.secret(), await encryptionKey()), env.network],
  );
  const row = await findRow(userId);
  if (!row) throw new Error(`Failed to provision managed wallet for ${userId}`);
  return row;
}

export const RESERVE_SPONSOR_USER = '__reserve_sponsor__';

async function fundAccount(userId: string, row: WalletRow): Promise<void> {
  if (isServiceAccount(userId)) {
    if (env.network === 'mainnet') {
      throw new Error(
        `Service account ${userId} (${row.public_key}) does not exist on mainnet. Create and fund it in the ` +
          'key ceremony and add the KMS signer before the backend uses it.',
      );
    }
    await fundWithFriendbot(row.public_key);
    return;
  }
  if (env.accountFunding === 'friendbot') {
    await fundWithFriendbot(row.public_key);
    return;
  }
  const holder = new CustodialSigner(Keypair.fromSecret(unseal(row.sealed_seed, await encryptionKey())));
  const trustlines = env.driverTrustlines.map((a) => new Asset(a.code, a.issuer));
  await createSponsoredAccount(await getReserveSponsor(), holder, trustlines);
}

export async function getReserveSponsor(): Promise<ReserveSponsor> {
  const wallet = await provisionManagedWallet(RESERVE_SPONSOR_USER);
  return { address: wallet.address, signer: await getManagedSigner(RESERVE_SPONSOR_USER) };
}

export async function provisionManagedWallet(userId: string): Promise<ManagedWallet> {
  const row = (await findRow(userId)) ?? (await insertRow(userId));
  if (row.provisioned) return toWallet(row);

  if (!(await accountExists(row.public_key))) {
    try {
      await fundAccount(userId, row);
      logger.info({ userId, address: row.public_key, funding: env.accountFunding }, 'provisioned managed wallet');
    } catch (e) {
      if (!(await accountExists(row.public_key))) throw e;
      logger.info({ userId, address: row.public_key }, 'managed wallet funded concurrently');
    }
  }
  await db().query('update managed_wallets set provisioned = true where user_id = $1', [userId]);
  return toWallet({ ...row, provisioned: true });
}

export async function getManagedWallet(userId: string): Promise<ManagedWallet | null> {
  const row = await findRow(userId);
  return row ? toWallet(row) : null;
}

const SERVICE_ACCOUNTS = new Set([
  '__settlement_source__',
  '__group_payout_source__',
  '__scout_issuer__',
  '__routing_swap_source__',
  RESERVE_SPONSOR_USER,
]);

export function isServiceAccount(userId: string): boolean {
  return SERVICE_ACCOUNTS.has(userId);
}

/**
 * Protocol-owned service accounts sign through SIGNER_BACKEND, so they can use a KMS-held key.
 * Per-user wallets always sign with their own sealed seed: a KMS key per driver would cost
 * $1 per driver per month, so the per-user tier is encrypt-at-rest by design, not by omission.
 */
export async function serviceAccountMasterSigner(userId: string): Promise<CustodialSigner> {
  if (!isServiceAccount(userId)) throw new Error(`${userId} is not a service account`);
  const row = await findRow(userId);
  if (!row) throw new Error(`No managed wallet for service account ${userId}`);
  return new CustodialSigner(Keypair.fromSecret(unseal(row.sealed_seed, await encryptionKey())));
}

export async function getManagedSigner(userId: string): Promise<Signer> {
  const row = await findRow(userId);
  if (!row) throw new Error(`No managed wallet for user ${userId} — sign in first`);
  if (isServiceAccount(userId)) return createSigner(Keypair.fromSecret(unseal(row.sealed_seed, await encryptionKey())));
  return new CustodialSigner(Keypair.fromSecret(unseal(row.sealed_seed, await encryptionKey())));
}
