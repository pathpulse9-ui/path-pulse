import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SettlementBatch } from '@pathpulse/contract';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

after(async () => {
  if (skip) return;
  const { closeDb } = await import('../db/client.js');
  await closeDb();
});

function batch(over: Partial<SettlementBatch> = {}): SettlementBatch {
  const id = `stl_${randomUUID()}`;
  return {
    id,
    createdAt: new Date().toISOString(),
    network: 'testnet',
    grossAmount: '10.0000000',
    asset: { code: 'XLM' },
    split: { authorities: '5.0000000', driverRewards: '3.0000000', treasury: '2.0000000' },
    driverPayouts: [],
    sourceAddress: 'GSOURCE',
    authoritiesAddress: 'GAUTH',
    driverPoolAddress: 'GPOOL',
    treasuryAddress: 'GTREASURY',
    txHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
    horizonUrl: '',
    ...over,
  };
}

const deposit = (txHash: string) => ({ txHash, from: 'GTREASURY', amount: '10.0000000', receivedAt: new Date().toISOString() });

test('concurrent settlements naming one deposit claim it exactly once, before anything is paid', { skip }, async () => {
  const { migrate } = await import('../db/client.js');
  await migrate();
  const { recordPendingBatch, findBatchIdByDeposit, getBatch } = await import('./settlementStore.js');
  const hash = randomUUID().replace(/-/g, '').padEnd(64, 'a');
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () => recordPendingBatch(batch({ deposit: deposit(hash) }))),
  );
  const won = attempts.filter((a) => a.status === 'fulfilled');
  assert.equal(won.length, 1);
  for (const a of attempts) {
    if (a.status === 'rejected') assert.equal((a.reason as Error).name, 'DepositAlreadyUsed');
  }
  const holder = await findBatchIdByDeposit(hash);
  assert.ok(holder);
  assert.equal((await getBatch(holder!))?.status, 'submitted');
});

test('a rejected submit releases the deposit so a corrected settlement can use it', { skip }, async () => {
  const { recordPendingBatch, setBatchStatus, findBatchIdByDeposit } = await import('./settlementStore.js');
  const hash = randomUUID().replace(/-/g, '').padEnd(64, 'b');
  const first = batch({ deposit: deposit(hash) });
  await recordPendingBatch(first);
  await assert.rejects(recordPendingBatch(batch({ deposit: deposit(hash) })), { name: 'DepositAlreadyUsed' });
  await setBatchStatus(first.id, 'failed');
  assert.equal(await findBatchIdByDeposit(hash), null);
  const retry = batch({ deposit: deposit(hash) });
  await recordPendingBatch(retry);
  assert.equal(await findBatchIdByDeposit(hash), retry.id);
});

test('a confirmed settlement keeps its deposit claimed', { skip }, async () => {
  const { recordPendingBatch, setBatchStatus } = await import('./settlementStore.js');
  const hash = randomUUID().replace(/-/g, '').padEnd(64, 'c');
  const first = batch({ deposit: deposit(hash) });
  await recordPendingBatch(first);
  await setBatchStatus(first.id, 'confirmed');
  await assert.rejects(recordPendingBatch(batch({ deposit: deposit(hash) })), { name: 'DepositAlreadyUsed' });
});

test('submitted batches are resolved from the ledger after a crash', { skip }, async () => {
  const { recordPendingBatch, getBatch, listBatches } = await import('./settlementStore.js');
  const { reconcileSubmittedBatches } = await import('./settlement.js');
  const { horizon } = await import('./network.js');
  const { db } = await import('../db/client.js');
  await db().query("update settlement_batches set status = 'failed' where status = 'submitted'");

  const landed = batch();
  const lost = batch({ createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
  const recent = batch();
  for (const b of [landed, lost, recent]) await recordPendingBatch(b);

  const original = horizon.transactions.bind(horizon);
  (horizon as unknown as { transactions: unknown }).transactions = () => ({
    transaction: (hash: string) => ({
      call: async () => {
        if (hash === landed.txHash) return { successful: true };
        throw Object.assign(new Error('not found'), { response: { status: 404 } });
      },
    }),
  });
  try {
    const out = await reconcileSubmittedBatches();
    assert.deepEqual(out.confirmed, [landed.id]);
    assert.deepEqual(out.failed, [lost.id]);
  } finally {
    (horizon as unknown as { transactions: unknown }).transactions = original;
  }
  assert.equal((await getBatch(landed.id))?.status, 'confirmed');
  assert.equal((await getBatch(lost.id))?.status, 'failed');
  assert.equal((await getBatch(recent.id))?.status, 'submitted');
  const listed = (await listBatches({ limit: 100 })).items.map((b) => b.id);
  assert.ok(!listed.includes(lost.id));
});

test('a malformed page cursor is a 400, not a database error', { skip }, async () => {
  const { listBatches } = await import('./settlementStore.js');
  const bad = Buffer.from('not-a-date|stl_x').toString('base64url');
  await assert.rejects(listBatches({ cursor: bad }), (e: Error & { status?: number }) => e.status === 400);
});
