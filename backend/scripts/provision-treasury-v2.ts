import { writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, TransactionBuilder, Operation, Asset, Memo, BASE_FEE } from '@stellar/stellar-sdk';
import { env } from '../src/config/env.js';
import { horizon, fundWithFriendbot } from '../src/stellar/network.js';

if (env.network !== 'testnet') {
  console.error('Refusing: not testnet');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../secrets/treasury-v2.json');

async function main() {
  const master = Keypair.random();
  const signers = [Keypair.random(), Keypair.random(), Keypair.random()];

  console.log('master  ', master.publicKey());
  signers.forEach((s, i) => console.log(`signer ${i + 1}`, s.publicKey()));

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: 'testnet',
        createdAt: new Date().toISOString(),
        treasury: master.publicKey(),
        masterSecret: master.secret(),
        signers: signers.map((s, i) => ({ index: i + 1, publicKey: s.publicKey(), secret: s.secret() })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  chmodSync(outPath, 0o600);
  console.log('secrets written to', outPath);

  await fundWithFriendbot(master.publicKey());
  console.log('funded via friendbot');

  const src = await horizon.loadAccount(master.publicKey());
  const builder = new TransactionBuilder(src, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  for (const s of signers) {
    builder.addOperation(
      Operation.setOptions({ signer: { ed25519PublicKey: s.publicKey(), weight: 1 } }),
    );
  }
  builder.addOperation(
    Operation.setOptions({
      masterWeight: 0,
      lowThreshold: 2,
      medThreshold: 2,
      highThreshold: 2,
    }),
  );
  const configTx = builder.setTimeout(180).build();
  configTx.sign(master);
  const configRes = await horizon.submitTransaction(configTx);
  console.log('CONFIG TX:', configRes.hash);

  const src2 = await horizon.loadAccount(master.publicKey());
  const payTx = new TransactionBuilder(src2, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: env.distribution.driverPool,
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .addMemo(Memo.text('T1 2-of-3 treasury'))
    .setTimeout(180)
    .build();
  payTx.sign(signers[0]);
  payTx.sign(signers[1]);
  const payRes = await horizon.submitTransaction(payTx);
  console.log('TWO-SIGNER TX:', payRes.hash);
}

main().catch((e) => {
  console.error('FAILED:', e?.response?.data?.extras?.result_codes ?? e.message);
  process.exit(1);
});
