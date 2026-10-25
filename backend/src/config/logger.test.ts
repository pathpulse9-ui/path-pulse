import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';

test('request logs never contain session cookies or bearer tokens', () => {
  const server = join(import.meta.dirname, '../server.ts');
  const script = `
    const { createServer } = await import(${JSON.stringify(server)});
    const app = createServer().listen(0);
    await new Promise((r) => app.once('listening', r));
    const base = 'http://127.0.0.1:' + app.address().port;
    await fetch(base + '/v1/auth/me', { headers: { cookie: 'pathpulse_session=SECRET-COOKIE-VALUE', authorization: 'Bearer SECRET-BEARER-VALUE' } });
    await fetch(base + '/v1/auth/guest', { method: 'POST' });
    app.close();
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', DATABASE_URL: '', SEP10_SIGNING_SECRET: Keypair.random().secret(), OPS_OPERATORS: 'ops@example.com' },
    encoding: 'utf8',
  });
  const out = r.stdout + r.stderr;
  assert.match(out, /\/v1\/auth\/me/);
  assert.match(out, /\[Redacted\]/);
  assert.doesNotMatch(out, /SECRET-COOKIE-VALUE|SECRET-BEARER-VALUE/);
  assert.doesNotMatch(out, /pathpulse_session=[A-Za-z0-9_-]+\./);
});
