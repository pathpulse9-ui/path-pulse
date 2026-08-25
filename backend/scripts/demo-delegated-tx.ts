import { provisionManagedWallet, getManagedWallet } from '../src/stellar/managed.js';
import { buildTransaction, submitTransaction } from '../src/stellar/transactions.js';
import { env } from '../src/config/env.js';

if (env.network !== 'testnet') {
  console.error('Refusing: not testnet');
  process.exit(1);
}

async function main() {
  const userId = 'demo_contributor_reviewer_1';
  const wallet = await provisionManagedWallet(userId);
  console.log('Provisioned managed wallet:', wallet.address);

  const built = await buildTransaction({
    userId,
    operations: [
      {
        type: 'payment',
        destination: wallet.address,
        asset: { code: 'XLM' },
        amount: '1',
      },
    ],
    memo: 'D1 delegated demo',
  });
  console.log('Built + delegate-signed. Local hash:', built.hash);

  const submitted = await submitTransaction(built.xdr);
  console.log('Submitted:', JSON.stringify(submitted, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
