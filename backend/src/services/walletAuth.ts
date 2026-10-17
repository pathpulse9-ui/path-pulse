import { randomUUID } from 'node:crypto';
import { Keypair, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

const CHALLENGE_TIMEOUT_SECONDS = 5 * 60;
const usedChallenges = new Map<string, number>();

function claimChallenge(signedTransaction: string, now = Date.now()): void {
  for (const [hash, until] of usedChallenges) if (until <= now) usedChallenges.delete(hash);
  const tx = TransactionBuilder.fromXDR(signedTransaction, env.networkPassphrase);
  const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
  const hash = inner.hash().toString('hex');
  if (usedChallenges.has(hash)) {
    const e = new Error('This challenge has already been used — request a new one') as Error & { status: number };
    e.status = 401;
    throw e;
  }
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

  claimChallenge(signedTransaction);
  return upsertWalletUser(clientAccountID);
}
