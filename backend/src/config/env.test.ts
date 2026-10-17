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

test('mainnet refuses to boot without the Aquarius RPC and router', () => {
  const r = bootOnMainnet({ SOROBAN_RPC_URL: '', AQUA_ROUTER_CONTRACT: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Aquarius routing on mainnet needs SOROBAN_RPC_URL and AQUA_ROUTER_CONTRACT/);
});

test('mainnet does not require a StellarBroker partner key', () => {
  const r = bootOnMainnet({ STELLARBROKER_PARTNER_KEY: '' });
  assert.doesNotMatch(r.stderr, /STELLARBROKER_PARTNER_KEY/);
});

test('mainnet boots on imported PulseGen batches without live credentials', () => {
  const r = bootOnMainnet({ PULSEGEN_BASE_URL: '', PULSEGEN_API_KEY: '' });
  assert.doesNotMatch(r.stderr, /PULSEGEN/);
});

test('mainnet refuses to boot without the SDP credentials', () => {
  const missing = bootOnMainnet({ SDP_BASE_URL: '', SDP_API_KEY: '', SDP_WALLET_ID: '', SDP_ASSET_ID: '' });
  assert.notEqual(missing.status, 0);
  for (const name of ['SDP_BASE_URL', 'SDP_API_KEY', 'SDP_WALLET_ID', 'SDP_ASSET_ID']) {
    assert.match(missing.stderr, new RegExp(`${name} must be set on mainnet`));
  }
  const set = bootOnMainnet({ SDP_BASE_URL: 'https://sdp.example', SDP_API_KEY: 'k', SDP_WALLET_ID: 'w', SDP_ASSET_ID: 'a' });
  assert.doesNotMatch(set.stderr, /SDP_[A-Z_]+ must be set on mainnet/);
});

test('mainnet refuses a localhost home domain for the SCOUT issuer', () => {
  const r = bootOnMainnet({ SEP10_HOME_DOMAIN: 'localhost:8080' });
  assert.match(r.stderr, /SEP10_HOME_DOMAIN must be the public API host on mainnet/);
});
