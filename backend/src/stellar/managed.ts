import { Asset, Keypair } from '@stellar/stellar-sdk';
import type { ManagedWallet } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { isLegacySealed, keyFromEnv, seal, unseal } from '../crypto/seal.js';
import { fundWithFriendbot, accountExists } from './network.js';
import { CustodialSigner, type Signer } from './signing.js';
import { createSponsoredAccount, type ReserveSponsor } from './sponsorship.js';
import { logger } from '../config/logger.js';

interface WalletRow {
  user_id: string;
  public_key: string;
  sealed_seed: string;
  provisioned: boolean;
  network: string;
}

let cachedKey: Buffer | null = null;

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

export function sealBinding(userId: string, publicKey: string, network: string): string {
  return `pathpulse-seed|${network}|${userId}|${publicKey}`;
}

async function rowKeypair(row: WalletRow): Promise<Keypair> {
  const secret = unseal(row.sealed_seed, await encryptionKey(), sealBinding(row.user_id, row.public_key, row.network));
  const kp = Keypair.fromSecret(secret);
  if (kp.publicKey() !== row.public_key) {
    throw new Error(`Sealed seed for ${row.user_id} does not belong to ${row.public_key}`);
  }
  return kp;
}

export async function countLegacySeeds(): Promise<number> {
  if (!env.databaseUrl) return 0;
  const r = await db().query<{ n: string }>("select count(*)::text as n from managed_wallets where sealed_seed like 'v1.%'");
  return Number(r.rows[0].n);
}

export async function resealLegacySeeds(): Promise<number> {
  if (!env.databaseUrl) return 0;
  const rows = await db().query<WalletRow>(
    "select user_id, public_key, sealed_seed, provisioned, network from managed_wallets where sealed_seed like 'v1.%'",
  );
  if (!rows.rowCount) return 0;
  const key = await encryptionKey();
  let resealed = 0;
  for (const row of rows.rows) {
    if (!isLegacySealed(row.sealed_seed)) continue;
    let kp: Keypair;
    try {
      kp = Keypair.fromSecret(unseal(row.sealed_seed, key));
    } catch (e) {
      logger.error({ err: e, userId: row.user_id }, 'legacy sealed seed could not be opened; left as is');
      continue;
    }
    if (kp.publicKey() !== row.public_key) {
      logger.error({ userId: row.user_id }, 'legacy sealed seed belongs to a different account; left as is');
      continue;
    }
    const bound = seal(kp.secret(), key, sealBinding(row.user_id, row.public_key, row.network));
    const updated = await db().query(
      'update managed_wallets set sealed_seed = $3 where user_id = $1 and sealed_seed = $2',
      [row.user_id, row.sealed_seed, bound],
    );
    resealed += updated.rowCount ?? 0;
  }
  logger.info({ resealed, legacy: rows.rowCount }, 'legacy sealed seeds rebound to their rows');
  return resealed;
}

async function insertRow(userId: string): Promise<WalletRow> {
  assertNotReserved(userId);
  const kp = Keypair.random();
  await db().query(
    `insert into managed_wallets (user_id, public_key, sealed_seed, provisioned, network)
     values ($1, $2, $3, false, $4)
     on conflict (user_id) do nothing`,
    [
      userId,
      kp.publicKey(),
      seal(kp.secret(), await encryptionKey(), sealBinding(userId, kp.publicKey(), env.network)),
      env.network,
    ],
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
  const holder = new CustodialSigner(await rowKeypair(row));
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

export async function ensureManagedWalletKey(userId: string): Promise<ManagedWallet> {
  return toWallet((await findRow(userId)) ?? (await insertRow(userId)));
}

export async function getManagedWallet(userId: string): Promise<ManagedWallet | null> {
  const row = await findRow(userId);
  return row ? toWallet(row) : null;
}

const RESERVED_ID = /^__.*__$/;

const SERVICE_ACCOUNTS = new Set([
  '__settlement_source__',
  '__group_payout_source__',
  '__scout_issuer__',
  '__routing_swap_source__',
  RESERVE_SPONSOR_USER,
]);

export function assertNotReserved(userId: string): void {
  if (RESERVED_ID.test(userId) && !SERVICE_ACCOUNTS.has(userId)) {
    const e = new Error('That user id is reserved') as Error & { status: number };
    e.name = 'ValidationError';
    e.status = 400;
    throw e;
  }
}

export function isServiceAccount(userId: string): boolean {
  return SERVICE_ACCOUNTS.has(userId);
}

export async function serviceAccountMasterSigner(userId: string): Promise<CustodialSigner> {
  if (!isServiceAccount(userId)) throw new Error(`${userId} is not a service account`);
  const row = await findRow(userId);
  if (!row) throw new Error(`No managed wallet for service account ${userId}`);
  return new CustodialSigner(await rowKeypair(row));
}

export interface LedgerSigners {
  signers: { key: string; weight: number }[];
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
}

export function kmsCanSignAlone(account: LedgerSigners, kmsPublicKey: string): boolean {
  const weight = account.signers.find((s) => s.key === kmsPublicKey)?.weight ?? 0;
  const { low_threshold, med_threshold, high_threshold } = account.thresholds;
  return weight > 0 && weight >= Math.max(low_threshold, med_threshold, high_threshold, 1);
}

const KMS_ROUTE_TTL_MS = 5 * 60 * 1000;
const kmsRoute = new Map<string, { at: number; kms: boolean }>();
let kmsSigner: Promise<Signer> | null = null;

async function serviceKmsSigner(): Promise<Signer> {
  if (!kmsSigner) {
    kmsSigner = (async () => {
      const { AwsKmsSigner } = await import('./kms.js');
      return AwsKmsSigner.create(env.kms.keyId);
    })();
    kmsSigner.catch(() => {
      kmsSigner = null;
    });
  }
  return kmsSigner;
}

export async function kmsServiceAddress(): Promise<string | null> {
  if (env.signerBackend !== 'aws-kms') return null;
  return (await serviceKmsSigner()).publicKey;
}

export function serviceSigningMode(): Record<string, 'kms' | 'sealed-seed'> {
  return Object.fromEntries([...kmsRoute].map(([address, r]) => [address, r.kms ? 'kms' : 'sealed-seed']));
}

async function routesThroughKms(address: string): Promise<Signer | null> {
  if (env.signerBackend !== 'aws-kms') return null;
  const cached = kmsRoute.get(address);
  if (cached && Date.now() - cached.at < KMS_ROUTE_TTL_MS) return cached.kms ? serviceKmsSigner() : null;
  const { horizon } = await import('./network.js');
  const account = (await horizon.loadAccount(address)) as unknown as LedgerSigners;
  const signer = account.signers.some((s) => s.key !== address && s.weight > 0) ? await serviceKmsSigner() : null;
  const kms = signer !== null && kmsCanSignAlone(account, signer.publicKey);
  kmsRoute.set(address, { at: Date.now(), kms });
  if (!kms) {
    logger.warn(
      { address, kms: signer?.publicKey ?? null },
      'service account still signs with its sealed seed — attach the KMS key and retire the master key',
    );
  }
  return kms ? signer : null;
}

export async function getManagedSigner(userId: string): Promise<Signer> {
  const row = await findRow(userId);
  if (!row) throw new Error(`No managed wallet for user ${userId} — sign in first`);
  if (isServiceAccount(userId)) {
    const kms = await routesThroughKms(row.public_key);
    if (kms) return kms;
  }
  return new CustodialSigner(await rowKeypair(row));
}
