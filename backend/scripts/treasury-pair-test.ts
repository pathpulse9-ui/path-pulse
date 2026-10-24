import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Asset, Horizon, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const TREASURY = 'GCESVOGE2FLAWTV6D2BQ7H3KRRJT5D74IXWEGR7MZQUJK2MNMBD5MIA3';
const DRIVER_POOL = 'GCG73RPSFQUNDS3RGGBB2IO5WLGUAUHVD6WTAIIOZD4X4ANBSFYCQ44B';
const TESTS: Record<string, string> = {
  A: 'Naved + Umair',
  B: 'Umair + Daiwik',
  C: 'Naved + Daiwik',
  X: 'one signer only (must fail tx_bad_auth)',
};
const horizon = new Horizon.Server('https://horizon.stellar.org');

async function main() {
  const test = (process.argv[2] ?? '').toUpperCase();
  if (!TESTS[test]) throw new Error('usage: tsx scripts/treasury-pair-test.ts <A|B|C|X>');
  const account = await horizon.loadAccount(TREASURY);
  const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: DRIVER_POOL, asset: Asset.native(), amount: '0.0000001' }))
    .addMemo(Memo.text(`treasury pair test ${test}`))
    .setTimeout(900)
    .build();
  const xdr = tx.toXDR();
  const out = resolve(import.meta.dirname, `../../docs/evidence/treasury-pair-test-${test}.xdr`);
  writeFileSync(out, xdr + '\n');
  console.log(`test ${test} — sign with ${TESTS[test]}; valid 15 minutes; sequence ${tx.sequence}`);
  console.log(`unsigned XDR (also saved to ${out}):\n\n${xdr}\n`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
