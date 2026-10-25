import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '../src/config/env.js';
import { fundWithFriendbot } from '../src/stellar/network.js';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../secrets/distribution-v2.json');
const horizon = new Horizon.Server(env.horizonUrl);

if (env.network !== 'testnet') {
  console.error('Refusing to run: STELLAR_NETWORK is not testnet.');
  process.exit(1);
}

async function main() {
  const kp = Keypair.random();
  process.stdout.write(`Funding driver_pool ${kp.publicKey()} ... `);
  await fundWithFriendbot(kp.publicKey());
  console.log('ok');

  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  console.log(`USDC trustline  : ${res.hash}`);

  const existing = JSON.parse(readFileSync(outPath, 'utf8')) as {
    accounts: Record<string, { publicKey: string; secret: string }>;
    [k: string]: unknown;
  };
  existing.accounts.driver_pool = { publicKey: kp.publicKey(), secret: kp.secret() };
  existing.note =
    `${existing.note ?? ''} Replaces driver_pool GD2J6WSB… (seed unrecoverable, could never hold USDC).`.trim();
  writeFileSync(outPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  chmodSync(outPath, 0o600);
  console.log(`secret written  : ${outPath} (0600)`);

  console.log(`\nSet in .env and redeploy:\nDRIVER_POOL_PUBLIC=${kp.publicKey()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
