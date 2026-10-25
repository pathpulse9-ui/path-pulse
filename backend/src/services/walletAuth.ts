import { randomUUID } from 'node:crypto';
import { Keypair, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

const CHALLENGE_TIMEOUT_SECONDS = 5 * 60;
const MAX_USED_CHALLENGES = 10_000;
const usedChallenges = new Map<string, number>();

function alreadyUsed(): Error {
  const e = new Error('This challenge has already been used — request a new one') as Error & { status: number };
  e.status = 401;
  return e;
}

export async function claimChallenge(signedTransaction: string, now = Date.now()): Promise<void> {
  const tx = TransactionBuilder.fromXDR(signedTransaction, env.networkPassphrase);
  const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
  const hash = inner.hash().toString('hex');
  if (env.databaseUrl) {
    await db().query('delete from sep10_used_challenges where expires_at < now()');
    const claimed = await db().query(
      'insert into sep10_used_challenges (hash, expires_at) values ($1, $2) on conflict (hash) do nothing returning hash',
      [hash, new Date(now + CHALLENGE_TIMEOUT_SECONDS * 1000)],
    );
    if (claimed.rowCount === 0) throw alreadyUsed();
    return;
  }
  for (const [h, until] of usedChallenges) if (until <= now) usedChallenges.delete(h);
  if (usedChallenges.has(hash)) throw alreadyUsed();
  if (usedChallenges.size >= MAX_USED_CHALLENGES) usedChallenges.delete(usedChallenges.keys().next().value as string);
  usedChallenges.set(hash, now + CHALLENGE_TIMEOUT_SECONDS * 1000);
}

const serverKeypair = env.sep10.signingSecret
  ? Keypair.fromSecret(env.sep10.signingSecret)
  : Keypair.random();

if (!env.sep10.signingSecret) {
  logger.warn(
    { publicKey: serverKeypair.publicKey() },
    'SEP10_SIGNING_SECRET not set — using an ephemeral dev keypair (resets on restart)',
  );
}

interface WalletUser {
  userId: string;
  address: string;
}

export function serverSigningKey(): string {
  return serverKeypair.publicKey();
}

async function upsertWalletUser(address: string): Promise<WalletUser> {
  await db().query(
    'insert into wallet_users (address, user_id) values ($1, $2) on conflict (address) do nothing',
    [address, randomUUID()],
  );
  const r = await db().query<{ user_id: string }>(
    'select user_id from wallet_users where address = $1',
    [address],
  );
  if (!r.rows[0]) throw new Error(`Failed to persist wallet user for ${address}`);
  return { userId: r.rows[0].user_id, address };
}

export function buildChallenge(account: string): { transaction: string; networkPassphrase: string } {
  const transaction = WebAuth.buildChallengeTx(
    serverKeypair,
    account,
    env.sep10.homeDomain,
    CHALLENGE_TIMEOUT_SECONDS,
    env.networkPassphrase,
    env.sep10.homeDomain,
  );
  return { transaction, networkPassphrase: env.networkPassphrase };
}

export async function verifyChallenge(signedTransaction: string): Promise<WalletUser> {
  const { clientAccountID } = WebAuth.readChallengeTx(
    signedTransaction,
    serverKeypair.publicKey(),
    env.networkPassphrase,
    env.sep10.homeDomain,
    env.sep10.homeDomain,
  );

  WebAuth.verifyChallengeTxSigners(
    signedTransaction,
    serverKeypair.publicKey(),
    env.networkPassphrase,
    [clientAccountID],
    env.sep10.homeDomain,
    env.sep10.homeDomain,
  );

  await claimChallenge(signedTransaction);
  return upsertWalletUser(clientAccountID);
}
