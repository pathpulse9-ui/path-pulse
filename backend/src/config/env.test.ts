import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function bootOnMainnet(overrides: Record<string, string>) {
  const envFile = join(import.meta.dirname, 'env.ts');
  return spawnSync(process.execPath, ['--import', 'tsx', '-e', `await import(${JSON.stringify(envFile)})`], {
    env: { ...process.env, STELLAR_NETWORK: 'mainnet', ...overrides },
    encoding: 'utf8',
  });
}

test('mainnet refuses to boot with a plaintext KEK or Friendbot funding', () => {
  const r = bootOnMainnet({ KEY_ENCRYPTION_KEY_CIPHERTEXT: '', ACCOUNT_FUNDING: 'friendbot' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /KEY_ENCRYPTION_KEY_CIPHERTEXT must be set on mainnet/);
  assert.match(r.stderr, /ACCOUNT_FUNDING must be "sponsor" on mainnet/);
});

test('an unknown funding mode is rejected at boot on any network', () => {
  const r = bootOnMainnet({ STELLAR_NETWORK: 'testnet', ACCOUNT_FUNDING: 'airdrop' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ACCOUNT_FUNDING must be friendbot\|sponsor/);
});

test('mainnet refuses Aquarius routing without its RPC and router configured', () => {
  const r = bootOnMainnet({ ROUTING_PROVIDERS: 'aquarius,stellarbroker', SOROBAN_RPC_URL: '', AQUA_ROUTER_CONTRACT: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Aquarius routing on mainnet needs SOROBAN_RPC_URL and AQUA_ROUTER_CONTRACT/);
  const brokerOnly = bootOnMainnet({ ROUTING_PROVIDERS: 'stellarbroker', SOROBAN_RPC_URL: '', AQUA_ROUTER_CONTRACT: '' });
  assert.doesNotMatch(brokerOnly.stderr, /Aquarius routing on mainnet/);
});

test('the PulseGen pilot override lets mainnet boot past the missing-credentials check only', () => {
  const blocked = bootOnMainnet({ PULSEGEN_BASE_URL: '', PULSEGEN_API_KEY: '', PULSEGEN_PILOT_SYNTHETIC: '' });
  assert.match(blocked.stderr, /PULSEGEN_BASE_URL and PULSEGEN_API_KEY must be set on mainnet/);
  const pilot = bootOnMainnet({ PULSEGEN_BASE_URL: '', PULSEGEN_API_KEY: '', PULSEGEN_PILOT_SYNTHETIC: 'true' });
  assert.doesNotMatch(pilot.stderr, /PULSEGEN_BASE_URL and PULSEGEN_API_KEY/);
});
