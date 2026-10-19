import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
process.env.KEY_ENCRYPTION_KEY_CIPHERTEXT = '';
process.env.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

after(async () => {
  if (skip) return;
  const { closeDb } = await import('../db/client.js');
  await closeDb();
});

test('copying another row\'s sealed seed onto your own wallet row does not let you sign with it', { skip }, async () => {
  const { migrate, db } = await import('../db/client.js');
  await migrate();
  const { getManagedSigner, getManagedWallet } = await import('./managed.js');
  const { seal } = await import('../crypto/seal.js');
  const { keyFromEnv } = await import('../crypto/seal.js');
  const { env } = await import('../config/env.js');
  const key = keyFromEnv(env.keyEncryptionKey);
  const victim = Keypair.random();
  const attacker = Keypair.random();
  const victimId = `victim_${randomUUID()}`;
  const attackerId = `attacker_${randomUUID()}`;
  const { sealBinding } = await import('./managed.js');
  const victimSealed = seal(victim.secret(), key, sealBinding(victimId, victim.publicKey(), env.network));
  await db().query(
    'insert into managed_wallets (user_id, public_key, sealed_seed, provisioned, network) values ($1,$2,$3,true,$4), ($5,$6,$7,true,$4)',
    [victimId, victim.publicKey(), victimSealed, env.network, attackerId, attacker.publicKey(), victimSealed],
  );
  assert.equal((await getManagedSigner(victimId)).publicKey, victim.publicKey());
  assert.equal((await getManagedWallet(attackerId))?.address, attacker.publicKey());
  await assert.rejects(getManagedSigner(attackerId));
});

test('legacy seals are rebound to their own row once, and a mismatched legacy seal is left unusable', { skip }, async () => {
  const { db } = await import('../db/client.js');
  const { resealLegacySeeds, getManagedSigner } = await import('./managed.js');
  const { seal, keyFromEnv } = await import('../crypto/seal.js');
  const { env } = await import('../config/env.js');
  const key = keyFromEnv(env.keyEncryptionKey);
  const honest = Keypair.random();
  const other = Keypair.random();
  const honestId = `legacy_${randomUUID()}`;
  const swappedId = `swapped_${randomUUID()}`;
  await db().query(
    'insert into managed_wallets (user_id, public_key, sealed_seed, provisioned, network) values ($1,$2,$3,true,$4), ($5,$6,$7,true,$4)',
    [honestId, honest.publicKey(), seal(honest.secret(), key), env.network, swappedId, Keypair.random().publicKey(), seal(other.secret(), key)],
  );
  await resealLegacySeeds();
  assert.equal((await getManagedSigner(honestId)).publicKey, honest.publicKey());
  const row = await db().query<{ sealed_seed: string }>('select sealed_seed from managed_wallets where user_id = $1', [swappedId]);
  assert.ok(row.rows[0].sealed_seed.startsWith('v1.'));
  await assert.rejects(getManagedSigner(swappedId));
});
