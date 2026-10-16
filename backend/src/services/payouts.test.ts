import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('a live payout batch is refused before any record is written when SDP is unreachable', () => {
  const payouts = join(import.meta.dirname, 'payouts.ts');
  const script = `
    const { createPayoutBatch } = await import(${JSON.stringify(payouts)});
    try {
      await createPayoutBatch([{ userId: 'u1', address: 'GA', tier: 'T1', amount: '1' }], { code: 'XLM' });
      console.log(JSON.stringify({ created: true }));
    } catch (e) {
      console.log(JSON.stringify({ name: e.name, status: e.status }));
    }
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      SDP_API_KEY: 'k',
      SDP_WALLET_ID: 'w',
      SDP_ASSET_ID: 'a',
      SDP_BASE_URL: 'http://127.0.0.1:9',
    },
    encoding: 'utf8',
  });
  const last = r.stdout.trim().split('\n').at(-1) ?? '';
  assert.deepEqual(JSON.parse(last), { name: 'PayoutProviderUnavailable', status: 503 }, r.stderr);
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  'a payout batch records the operator who created it',
  { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL not set — needs a disposable Postgres' },
  () => {
    const payouts = join(import.meta.dirname, 'payouts.ts');
    const client = join(import.meta.dirname, '../db/client.ts');
    const script = `
      const { migrate, closeDb } = await import(${JSON.stringify(client)});
      const { createPayoutBatch, getPayoutBatch } = await import(${JSON.stringify(payouts)});
      await migrate();
      const created = await createPayoutBatch(
        [{ userId: 'u1', address: 'GA', tier: 1, multiplier: 1, amount: '1' }],
        { code: 'XLM' },
        { createdBy: 'operator_42' },
      );
      const stored = await getPayoutBatch(created.id);
      console.log(JSON.stringify({ createdBy: stored.createdBy, sandbox: stored.sandbox }));
      await closeDb();
    `;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl, SDP_API_KEY: '' },
      encoding: 'utf8',
    });
    const result = r.stdout.split('\n').find((line) => line.startsWith('{"createdBy"')) ?? '{}';
    assert.deepEqual(JSON.parse(result), { createdBy: 'operator_42', sandbox: true }, r.stderr);
  },
);
