import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Account, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { submitToHorizon } from './network.js';
import { simulateAndSubmit } from './soroban.js';
import { assertMainnetAllowed } from './networkGuard.js';

const mutableEnv = env as unknown as { network: string; mainnetAllow: boolean };
const original = { network: env.network, mainnetAllow: env.mainnetAllow };

afterEach(() => {
  mutableEnv.network = original.network;
  mutableEnv.mainnetAllow = original.mainnetAllow;
});

function dummyTx() {
  const source = new Account(Keypair.random().publicKey(), '1');
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(30)
    .build();
}

test('mainnet without the second sign-off refuses before anything reaches Horizon', async () => {
  mutableEnv.network = 'mainnet';
  mutableEnv.mainnetAllow = false;
  await assert.rejects(submitToHorizon(dummyTx(), 'test submit'), (e: Error & { status?: number }) => {
    assert.equal(e.name, 'MainnetGateClosed');
    assert.equal(e.status, 403);
    assert.match(e.message, /test submit/);
    return true;
  });
});

test('mainnet Soroban submits are refused before simulation', async () => {
  mutableEnv.network = 'mainnet';
  mutableEnv.mainnetAllow = false;
  const signer = { publicKey: 'G', sign: async () => assert.fail('must not sign') };
  await assert.rejects(simulateAndSubmit(dummyTx(), signer as never), { name: 'MainnetGateClosed' });
});

test('the gate opens only with STELLAR_MAINNET_ALLOW', () => {
  mutableEnv.network = 'mainnet';
  mutableEnv.mainnetAllow = true;
  assert.doesNotThrow(() => assertMainnetAllowed('x'));
  mutableEnv.network = 'testnet';
  mutableEnv.mainnetAllow = false;
  assert.doesNotThrow(() => assertMainnetAllowed('x'));
});

test('every transaction submit goes through the guarded helpers', () => {
  const root = join(import.meta.dirname, '..');
  const allowed = new Set(['stellar/network.ts', 'stellar/soroban.ts']);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
        const rel = relative(root, path);
        if (allowed.has(rel)) continue;
        if (/\.submitTransaction\(|\.sendTransaction\(/.test(readFileSync(path, 'utf8'))) offenders.push(rel);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `direct submits bypass the mainnet gate in: ${offenders.join(', ')}`);
});
