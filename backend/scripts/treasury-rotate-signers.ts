import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_FEE, Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

const TREASURY = 'GCESVOGE2FLAWTV6D2BQ7H3KRRJT5D74IXWEGR7MZQUJK2MNMBD5MIA3';
const OLD_SIGNERS_FILE = resolve(import.meta.dirname, '../../secrets/treasury-v2.json');
const THRESHOLD = 2;
const horizon = new Horizon.Server('https://horizon.stellar.org');

function newSigners(): string[] {
  const raw = process.argv[process.argv.indexOf('--signers') + 1] ?? '';
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  if (!process.argv.includes('--signers') || keys.length !== 3) {
    throw new Error('usage: tsx scripts/treasury-rotate-signers.ts --signers G…,G…,G… [--confirm]');
  }
  for (const k of keys) if (!StrKey.isValidEd25519PublicKey(k)) throw new Error(`${k} is not a valid Stellar public key`);
  if (new Set(keys).size !== 3) throw new Error('the three new signers must be distinct');
  if (keys.includes(TREASURY)) throw new Error('the treasury cannot be its own signer');
  return keys;
}

function oldKeypairs(): Keypair[] {
  const file = JSON.parse(readFileSync(OLD_SIGNERS_FILE, 'utf8')) as {
    signers: { publicKey: string; secret?: string; secretKey?: string; seed?: string }[];
  };
  return file.signers.map((s) => {
    const secret = s.secret ?? s.secretKey ?? s.seed;
    const kp = secret ? Keypair.fromSecret(secret) : undefined;
    if (!kp || kp.publicKey() !== s.publicKey) throw new Error(`signer ${s.publicKey} in ${OLD_SIGNERS_FILE} has no matching secret`);
    return kp;
  });
}

async function showState(label: string) {
  const acc = await horizon.loadAccount(TREASURY);
  console.log(`${label}: thresholds ${acc.thresholds.low_threshold}/${acc.thresholds.med_threshold}/${acc.thresholds.high_threshold}`);
  for (const s of acc.signers) console.log(`  ${s.key === TREASURY ? 'master' : s.key} weight ${s.weight}`);
  return acc;
}

async function main() {
  const incoming = newSigners();
  const old = oldKeypairs();
  const acc = await showState('treasury now');

  const attached = acc.signers.filter((s) => s.key !== TREASURY && s.weight > 0).map((s) => s.key);
  const outgoing = old.filter((kp) => attached.includes(kp.publicKey()));
  if (incoming.some((k) => old.some((kp) => kp.publicKey() === k))) throw new Error('a new signer is one of the current keys; each signatory must generate a fresh key');
  if (attached.some((k) => !old.some((kp) => kp.publicKey() === k))) throw new Error('the treasury has a signer not in treasury-v2.json; stopping rather than guessing');
  if (outgoing.length < THRESHOLD) throw new Error(`only ${outgoing.length} current signers available; ${THRESHOLD} are needed to sign`);
  if (acc.thresholds.med_threshold !== THRESHOLD || acc.thresholds.high_threshold !== THRESHOLD) throw new Error('unexpected thresholds; stopping');

  console.log('\nplanned transaction (mainnet), one envelope:');
  outgoing.forEach((kp, i) => {
    console.log(`  remove ${kp.publicKey()}`);
    if (incoming[i]) console.log(`  add    ${incoming[i]} weight 1`);
  });
  incoming.slice(outgoing.length).forEach((k) => console.log(`  add    ${k} weight 1`));
  console.log(`  master stays 0, thresholds stay ${THRESHOLD}/${THRESHOLD}/${THRESHOLD}; signed by ${THRESHOLD} of the current keys`);

  if (!process.argv.includes('--confirm')) {
    console.log('\ndry run only. Re-run with --confirm to sign and submit.');
    return;
  }

  const fresh = await horizon.loadAccount(TREASURY);
  const builder = new TransactionBuilder(fresh, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC });
  outgoing.forEach((kp, i) => {
    builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: kp.publicKey(), weight: 0 } }));
    if (incoming[i]) builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: incoming[i], weight: 1 } }));
  });
  for (const k of incoming.slice(outgoing.length)) builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: k, weight: 1 } }));
  const tx = builder.setTimeout(120).build();
  for (const kp of outgoing.slice(0, THRESHOLD)) tx.sign(kp);

  const res = await horizon.submitTransaction(tx);
  console.log(`\nsubmitted · set_options tx ${res.hash}\nhttps://stellar.expert/explorer/public/tx/${res.hash}`);
  const after = await showState('treasury after');
  const live = after.signers.filter((s) => s.key !== TREASURY && s.weight > 0).map((s) => s.key).sort();
  if (live.join() !== [...incoming].sort().join()) throw new Error('signer set after submit does not match the three new keys — check Horizon');
  console.log('signer set matches the three new keys; the old treasury-v2.json keys can no longer sign');
}

main().catch((e) => {
  const extras = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras;
  console.error(extras?.result_codes ? `rejected: ${JSON.stringify(extras.result_codes)}` : (e as Error).message);
  process.exit(1);
});
