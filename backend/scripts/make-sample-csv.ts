import { writeFileSync } from 'node:fs';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');

const PEOPLE = [
  ['Aarav Sharma', '0.0100000', 'Week 35 delivery bonus'],
  ['Priya Nair', '0.0150000', 'Week 35 base payout'],
  ['Rohan Mehta', '0.0050000', 'Fuel reimbursement'],
  ['Ananya Iyer', '0.0200000', 'Week 35 base payout'],
  ['Vikram Desai', '0.0100000', 'Night shift differential'],
];

async function makeRecipient(label: string): Promise<string> {
  const kp = Keypair.random();
  const r = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status} for ${label}`);
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
  console.log(`  ${label.padEnd(14)} ${kp.publicKey()}`);
  return kp.publicKey();
}

async function main() {
  console.log('provisioning fresh recipients (funded + USDC trustline, unused by SDP):');
  const rows: string[] = ['name,address,amount,remarks'];
  for (const [name, amount, remark] of PEOPLE) {
    const address = await makeRecipient(name);
    rows.push(`${name},${address},${amount},${remark}`);
  }
  const out = '../../docs/samples/group-payout-usdc-sample.csv';
  writeFileSync(out, rows.join('\n') + '\n');
  console.log('');
  console.log('wrote docs/samples/group-payout-usdc-sample.csv');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
