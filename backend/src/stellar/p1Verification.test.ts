import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeToScVal } from '@stellar/stellar-sdk';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
process.env.SDP_API_KEY = '';

const ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const payouts = [{ userId: 'drv-1', address: ADDRESS, tier: 1 as const, multiplier: 1, amount: '1.0000000' }];

after(async () => {
  if (skip) return;
  const { closeDb } = await import('../db/client.js');
  await closeDb();
});

async function ready() {
  const { migrate } = await import('../db/client.js');
  await migrate();
}

test('a second payout batch for the same settlement is refused unless the first failed', { skip }, async () => {
  await ready();
  const { createPayoutBatch } = await import('../services/payouts.js');
  const { db } = await import('../db/client.js');
  const settlementBatchId = `stl_${randomUUID()}`;
  const first = await createPayoutBatch(payouts, { code: 'XLM' }, { settlementBatchId });
  await assert.rejects(
    createPayoutBatch(payouts, { code: 'XLM' }, { settlementBatchId }),
    (e: Error & { status?: number }) => e.name === 'DuplicatePayout' && e.status === 409,
  );
  const concurrent = await Promise.allSettled(
    Array.from({ length: 8 }, () => createPayoutBatch(payouts, { code: 'XLM' }, { settlementBatchId: `${settlementBatchId}_c` })),
  );
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  await db().query("update payout_batches set status = 'error' where id = $1", [first.id]);
  const retry = await createPayoutBatch(payouts, { code: 'XLM' }, { settlementBatchId });
  assert.notEqual(retry.id, first.id);
});

test('payout and group-payout lists page by keyset without gaps or repeats', { skip }, async () => {
  await ready();
  const { createPayoutBatch, listPayoutBatches } = await import('../services/payouts.js');
  const { executeGroupPayout, listGroupPayoutBatches } = await import('./groupPayout.js');
  const made: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    made.push((await createPayoutBatch(payouts, { code: 'XLM' })).id);
    await executeGroupPayout({ recipients: [{ name: 'n', address: ADDRESS, amount: '1.0000000' }] }, {});
  }
  const walk = async (list: (c?: string) => Promise<{ items: { id: string }[]; nextCursor: string | null }>) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(cursor);
      ids.push(...page.items.map((b) => b.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };
  const payoutIds = await walk((c) => listPayoutBatches(c, 2));
  assert.equal(new Set(payoutIds).size, payoutIds.length);
  for (const id of made) assert.ok(payoutIds.includes(id));
  const groupIds = await walk((c) => listGroupPayoutBatches(c, 2));
  assert.equal(new Set(groupIds).size, groupIds.length);
  assert.ok(groupIds.length >= 5);
});

test('a revocation recorded by another instance is honoured from the database', { skip }, async () => {
  await ready();
  const { db } = await import('../db/client.js');
  const { isSessionRevokedInDb } = await import('../services/session.js');
  const jti = randomUUID();
  const session = { userId: 'u', method: 'google' as const, jti };
  assert.equal(await isSessionRevokedInDb(session), false);
  await db().query('insert into revoked_sessions (jti, expires_at) values ($1, now() + interval \'1 hour\')', [jti]);
  assert.equal(await isSessionRevokedInDb(session), true);
});

test('swaps are serialised in-process and across connections', { skip }, async () => {
  await ready();
  const { withSwapLock, SWAP_LOCK_KEY } = await import('../routing/swapLock.js');
  const { db } = await import('../db/client.js');
  let running = 0;
  let peak = 0;
  const job = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 40));
    running -= 1;
  };
  await Promise.all([withSwapLock(job), withSwapLock(job), withSwapLock(job)]);
  assert.equal(peak, 1);

  let heldElsewhere: boolean | undefined;
  await withSwapLock(async () => {
    const probe = await db().connect();
    try {
      const r = await probe.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [SWAP_LOCK_KEY]);
      heldElsewhere = !r.rows[0].ok;
    } finally {
      await probe.query('select pg_advisory_unlock_all()');
      probe.release();
    }
  });
  assert.equal(heldElsewhere, true);
  const free = await db().query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [SWAP_LOCK_KEY]);
  assert.equal(free.rows[0].ok, true);
  await db().query('select pg_advisory_unlock_all()');
});

test('the swap output is read from the Soroban return value', async () => {
  const { stroopsFromScVal } = await import('./soroban.js');
  assert.equal(stroopsFromScVal(nativeToScVal(123_4567890n, { type: 'u128' })), 123_4567890n);
  assert.equal(stroopsFromScVal(nativeToScVal('not an amount', { type: 'string' })), undefined);
});

test('a Google subject binds to an email once, even under concurrent sign-ins', { skip }, async () => {
  await ready();
  const { userIdForEmail } = await import('../services/account.js');
  const { db } = await import('../db/client.js');
  const email = `bind_${randomUUID()}@example.com`;
  const results = await Promise.allSettled(
    ['sub-a', 'sub-b', 'sub-c', 'sub-d'].map((sub) => userIdForEmail(email, sub)),
  );
  const winners = results.filter((r) => r.status === 'fulfilled');
  assert.equal(winners.length, 1);
  for (const r of results) {
    if (r.status === 'rejected') assert.equal((r.reason as Error).name, 'AccountMismatch');
  }
  const row = await db().query<{ google_sub: string }>('select google_sub from users where email = $1', [email]);
  const bound = row.rows[0].google_sub;
  assert.equal(await userIdForEmail(email, bound), (winners[0] as PromiseFulfilledResult<string>).value);
});

test('a SEP-10 challenge can be claimed once across instances', { skip }, async () => {
  await ready();
  const { claimChallenge } = await import('../services/walletAuth.js');
  const { Account, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');
  const { env } = await import('../config/env.js');
  const kp = Keypair.random();
  const tx = new TransactionBuilder(new Account(kp.publicKey(), String(Date.now())), {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase ?? Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'pp auth', value: randomUUID().slice(0, 20) }))
    .setTimeout(300)
    .build();
  tx.sign(kp);
  const xdr = tx.toXDR();
  const attempts = await Promise.allSettled([claimChallenge(xdr), claimChallenge(xdr), claimChallenge(xdr)]);
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
  for (const a of attempts) {
    if (a.status === 'rejected') assert.equal((a.reason as { status?: number }).status, 401);
  }
});

test('withdrawals page by keyset in newest-first order without gaps or repeats', { skip }, async () => {
  await ready();
  const { saveSession } = await import('../services/offRampStore.js');
  const { listWithdrawals } = await import('../services/offramp.js');
  const userId = `pager_${randomUUID()}`;
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const id = `ors_${randomUUID()}`;
    ids.push(id);
    const at = new Date(1_700_000_000_000 + i * 1000).toISOString();
    await saveSession({
      id,
      ppUserId: userId,
      provider: 'carret',
      sandbox: true,
      status: 'completed',
      amount: '1.0000000',
      asset: { code: 'USDC' },
      fiatCurrency: 'INR',
      createdAt: at,
      updatedAt: at,
    } as never);
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await listWithdrawals(userId, cursor, 2);
    seen.push(...page.items.map((s) => s.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, [...ids].reverse());
});

test('a reserved service-account id cannot be created as a user wallet', { skip }, async () => {
  await ready();
  const { provisionManagedWallet } = await import('./managed.js');
  const { db } = await import('../db/client.js');
  await assert.rejects(
    provisionManagedWallet('__scout_issuer_clone__'),
    (e: Error & { status?: number }) => e.name === 'ValidationError' && e.status === 400,
  );
  const insert = (id: string) =>
    db().query(
      "insert into managed_wallets (user_id, public_key, sealed_seed, provisioned, network) values ($1, $2, 'x', false, 'testnet')",
      [id, `G${randomUUID()}`],
    );
  await assert.rejects(insert('__evil__'), /managed_wallets_reserved_ids/);
  const ok = `plain_${randomUUID()}`;
  await insert(ok);
  await db().query('delete from managed_wallets where user_id = $1', [ok]);
});
