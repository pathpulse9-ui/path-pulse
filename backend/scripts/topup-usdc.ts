import { Asset, BASE_FEE, Horizon, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { migrate, closeDb } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { provisionManagedWallet, getManagedSigner } from '../src/stellar/managed.js';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const horizon = new Horizon.Server(env.horizonUrl);

const ACCOUNT = process.argv[2] ?? '__settlement_source__';
const AMOUNT = process.argv[3] ?? '5';

function usdc(a: Horizon.AccountResponse): string {
  const b = a.balances.find(
    (x) => 'asset_code' in x && x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER,
  );
  return b && 'balance' in b ? b.balance : 'no trustline';
}

async function main() {
  await migrate();
  const wallet = await provisionManagedWallet(ACCOUNT);
  const signer = await getManagedSigner(ACCOUNT);
  const acct = await horizon.loadAccount(wallet.address);
  console.log(`${ACCOUNT}  ${wallet.address}`);
  console.log('  USDC before :', usdc(acct));

  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: '200',
        destination: wallet.address,
        destAsset: USDC,
        destAmount: AMOUNT,
        path: [],
      }),
    )
    .addMemo(Memo.text('usdc topup'))
    .setTimeout(120)
    .build();
  await signer.sign(tx);
  const res = await horizon.submitTransaction(tx);
  console.log('  tx          :', res.hash);
  console.log('  USDC after  :', usdc(await horizon.loadAccount(wallet.address)));
  await closeDb();
}

main().catch((e) => {
  console.error('FAILED:', e.message, JSON.stringify(e.response?.data?.extras?.result_codes ?? ''));
  process.exit(1);
});
