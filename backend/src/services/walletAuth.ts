import { randomUUID } from 'node:crypto';
import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const CHALLENGE_TIMEOUT_SECONDS = 5 * 60;

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

const usersByAddress = new Map<string, WalletUser>();

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

export function verifyChallenge(signedTransaction: string): WalletUser {
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

  let user = usersByAddress.get(clientAccountID);
  if (!user) {
    user = { userId: randomUUID(), address: clientAccountID };
    usersByAddress.set(clientAccountID, user);
  }
  return user;
}
