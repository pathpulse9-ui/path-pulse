import { BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from '../src/config/env.js';
import { closeDb, migrate } from '../src/db/client.js';
import { accountExists, horizon, submitToHorizon } from '../src/stellar/network.js';
import { getManagedWallet, provisionManagedWallet, serviceAccountMasterSigner } from '../src/stellar/managed.js';
import { createSigner } from '../src/stellar/signing.js';

const ACCOUNTS: Array<{ userId: string; role: string; fundXlm: number }> = [
  { userId: '__reserve_sponsor__', role: 'reserve sponsor (driver accounts + fees)', fundXlm: 10 },
  { userId: '__routing_swap_source__', role: 'routing swap source (Broker/Aquarius)', fundXlm: 25 },
  { userId: '__scout_issuer__', role: 'SCOUT issuer', fundXlm: 5 },
  { userId: '__settlement_source__', role: 'settlement source', fundXlm: 3 },
  { userId: '__group_payout_source__', role: 'group payout source', fundXlm: 3 },
];

async function addressOf(userId: string): Promise<string> {
  try {
    return (await provisionManagedWallet(userId)).address;
  } catch {
    const wallet = await getManagedWallet(userId);
    if (!wallet) throw new Error(`could not create a key for ${userId}`);
    return wallet.address;
  }
}

async function main() {
  if (env.network !== 'mainnet') throw new Error('mainnet-setup only runs with STELLAR_NETWORK=mainnet');
  const command = process.argv[2] ?? 'status';
  await migrate();
  const kms = (await createSigner()).publicKey;
  console.log(`network: mainnet · KMS signer: ${kms} · mainnet gate: ${env.mainnetAllow ? 'OPEN' : 'closed'}\n`);

  for (const a of ACCOUNTS) {
    const address = await addressOf(a.userId);
    if (!(await accountExists(address))) {
      console.log(`✗ ${a.role}\n    ${address}\n    not on mainnet yet — fund it with ~${a.fundXlm} XLM (createAccount)\n`);
      continue;
    }
    const acct = await horizon.loadAccount(address);
    const balances = acct.balances
      .map((b) => `${b.balance} ${'asset_code' in b ? b.asset_code : 'XLM'}`)
      .join(', ');
    const hasKms = acct.signers.some((s) => s.key === kms && s.weight > 0);
    console.log(`✓ ${a.role}\n    ${address}\n    ${balances}\n    KMS signer: ${hasKms ? 'attached' : 'missing'}`);

    if (command === 'attach-kms' && !hasKms) {
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
        .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: kms, weight: 1 } }))
        .setTimeout(120)
        .build();
      const signed = await (await serviceAccountMasterSigner(a.userId)).sign(tx);
      const res = await submitToHorizon(signed, 'attach KMS signer');
      console.log(`    KMS signer attached · tx ${res.hash}`);
    }
    console.log('');
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error((e as Error).message);
  await closeDb().catch(() => {});
  process.exit(1);
});
