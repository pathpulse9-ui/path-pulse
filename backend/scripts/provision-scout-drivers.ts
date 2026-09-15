/**
 * Issue the three SCOUT reputation badges on Stellar TESTNET (D6).
 *
 * The SCOUT issuer (GBKGCHRV…) was created and flagged on 2026-08-27 but has
 * never issued a badge — its whole history is create_account plus two
 * set_options, so no driver holds SCOUT1/2/3 and the "tiers visible in Stellar
 * wallets" measure cannot be demonstrated.
 *
 * `assignSampleTier()` in src/stellar/scout.ts mints its driver with
 * Keypair.random() and discards the secret, which is how the original driver
 * pool (GD2J6WSB…) became unusable. This runs the same on-chain sequence —
 * changeTrust → setTrustLineFlags authorize → payment 1 SCOUTn — but persists
 * every seed to secrets/scout-drivers.json (0600, gitignored) BEFORE anything
 * touches the network, and adds a USDC trustline so these drivers can actually
 * receive an SDP payout later.
 *
 *   SIGNER_BACKEND=dev KEY_ENCRYPTION_KEY_CIPHERTEXT= \
 *     pnpm --filter @pathpulse/backend exec tsx scripts/provision-scout-drivers.ts
 */
import { writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '../src/config/env.js';
import { fundWithFriendbot } from '../src/stellar/network.js';
import { getManagedWallet, getManagedSigner } from '../src/stellar/managed.js';

const SCOUT_ISSUER_USER = '__scout_issuer__';
const EXPECTED_ISSUER = 'GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4';
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
const TIERS = [1, 2, 3] as const;
const TIER_CODE: Record<(typeof TIERS)[number], string> = { 1: 'SCOUT1', 2: 'SCOUT2', 3: 'SCOUT3' };

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../secrets/scout-drivers.json');
const horizon = new Horizon.Server(env.horizonUrl);

if (env.network !== 'testnet') {
  console.error('Refusing to run: STELLAR_NETWORK is not testnet.');
  process.exit(1);
}

async function main() {
  const issuerWallet = await getManagedWallet(SCOUT_ISSUER_USER);
  if (!issuerWallet) {
    console.error(`No managed wallet row for ${SCOUT_ISSUER_USER} — wrong database. Refusing to mint a new issuer.`);
    process.exit(1);
  }
  if (issuerWallet.address !== EXPECTED_ISSUER) {
    console.error(`Issuer mismatch: resolved ${issuerWallet.address}, expected ${EXPECTED_ISSUER}. Aborting.`);
    process.exit(1);
  }
  const issuer = issuerWallet.address;
  const issuerSigner = await getManagedSigner(SCOUT_ISSUER_USER);
  console.log(`issuer          : ${issuer}`);

  const drivers = TIERS.map((tier) => ({ tier, code: TIER_CODE[tier], kp: Keypair.random() }));

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        note: 'SCOUT badge holders for D6 evidence. Seeds persisted so these drivers stay usable for SDP delivery.',
        network: env.network,
        issuer,
        createdAt: new Date().toISOString(),
        drivers: drivers.map((d) => ({
          tier: d.tier,
          code: d.code,
          publicKey: d.kp.publicKey(),
          secret: d.kp.secret(),
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  chmodSync(outPath, 0o600);
  console.log(`seeds written   : ${outPath} (0600)\n`);

  for (const d of drivers) {
    const badge = new Asset(d.code, issuer);
    process.stdout.write(`${d.code} ${d.kp.publicKey().slice(0, 8)}… funding ... `);
    await fundWithFriendbot(d.kp.publicKey());

    const driverAcct = await horizon.loadAccount(d.kp.publicKey());
    const trustTx = new TransactionBuilder(driverAcct, {
      fee: BASE_FEE,
      networkPassphrase: env.networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset: badge }))
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(120)
      .build();
    trustTx.sign(d.kp);
    await horizon.submitTransaction(trustTx);
    process.stdout.write('trustlines ok ... ');

    const issuerAcct = await horizon.loadAccount(issuer);
    const grantTx = new TransactionBuilder(issuerAcct, {
      fee: BASE_FEE,
      networkPassphrase: env.networkPassphrase,
    })
      .addOperation(Operation.setTrustLineFlags({ trustor: d.kp.publicKey(), asset: badge, flags: { authorized: true } }))
      .addOperation(Operation.payment({ destination: d.kp.publicKey(), asset: badge, amount: '1' }))
      .setTimeout(120)
      .build();
    await issuerSigner.sign(grantTx);
    const res = await horizon.submitTransaction(grantTx);
    console.log(`issued ${res.hash}`);
  }

  console.log('\nDrivers for the settlement multiplier proof (submit all as tier 1):');
  for (const d of drivers) console.log(`  ${d.code}  ${d.kp.publicKey()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
