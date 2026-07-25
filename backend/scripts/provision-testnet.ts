/**
 * Provision the three protocol-governed distribution accounts on Stellar TESTNET:
 *   - Partner Revenue
 *   - Driver Pool
 *   - PathPulse Treasury
 *
 * Generates keypairs, funds them via Friendbot, and writes PUBLIC keys to stdout
 * plus a `.testnet-accounts.json` file. SECRET keys are printed once for you to
 * store in your secret manager — they are NOT written to disk by this script.
 *
 * The treasury multisig configuration is intentionally NOT applied here: that is
 * human-gated. Run the backend and GET /v1/treasury/config after you set the
 * signer public keys, then review + sign the SetOptions XDR manually.
 *
 *   npm run provision:testnet   (from backend/)
 */
import { writeFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { env } from '../src/config/env.js';
import { fundWithFriendbot } from '../src/stellar/network.js';

if (env.network !== 'testnet') {
  console.error('Refusing to run: STELLAR_NETWORK is not testnet.');
  process.exit(1);
}

const ROLES = ['partner_revenue', 'driver_pool', 'treasury'] as const;

async function main() {
  const out: Record<string, string> = {};
  const secrets: Record<string, string> = {};

  for (const role of ROLES) {
    const kp = Keypair.random();
    process.stdout.write(`Funding ${role} (${kp.publicKey()}) ... `);
    await fundWithFriendbot(kp.publicKey());
    console.log('ok');
    out[role] = kp.publicKey();
    secrets[role] = kp.secret();
  }

  writeFileSync(
    '.testnet-accounts.json',
    JSON.stringify({ network: 'testnet', accounts: out }, null, 2),
  );

  console.log('\n── PUBLIC keys (written to .testnet-accounts.json, safe to commit env) ──');
  for (const role of ROLES) console.log(`${role.toUpperCase()}_PUBLIC=${out[role]}`);

  console.log('\n── SECRET keys (store in your secret manager — NOT written to disk) ──');
  for (const role of ROLES) console.log(`# ${role}: ${secrets[role]}`);

  console.log(
    '\nNext: set TREASURY_SIGNER_{1,2,3}_PUBLIC in .env, then review the multisig XDR' +
      ' from GET /v1/treasury/config before a human signs it (human-gated).',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
