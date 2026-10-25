import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('in-memory settlement pages by keyset without skipping or repeating rows', () => {
  const store = join(import.meta.dirname, 'settlementStore.ts');
  const script = `
    const { saveBatch, listBatches } = await import(${JSON.stringify(store)});
    const mk = (i) => ({ id: 'stl_' + i, createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(), network: 'testnet', grossAmount: '1.0000000', asset: { code: 'USDC' }, driverPayouts: [] });
    for (let i = 0; i < 7; i++) await saveBatch(mk(i));
    const seen = [];
    let cursor;
    do {
      const page = await listBatches({ limit: 3, cursor });
      seen.push(...page.items.map((b) => b.id));
      if (cursor === undefined) await saveBatch(mk(99));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    console.log('RESULT' + JSON.stringify(seen));
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
    env: { ...process.env, DATABASE_URL: '', LOG_LEVEL: 'silent' },
    encoding: 'utf8',
  });
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT')) ?? '';
  assert.deepEqual(JSON.parse(line.slice(6)), ['stl_6', 'stl_5', 'stl_4', 'stl_3', 'stl_2', 'stl_1', 'stl_0'], r.stderr);
});
