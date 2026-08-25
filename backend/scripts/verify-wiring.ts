import { ensureAccountForEmail } from '../src/services/account.js';
import { buildTransaction, submitTransaction } from '../src/stellar/transactions.js';

async function main() {
  const { userId, wallet } = await ensureAccountForEmail('reviewer.t1@example.com');
  console.log('email/OAuth provisioned:', userId, wallet.address);

  const built = await buildTransaction({
    userId,
    operations: [{ type: 'payment', destination: wallet.address, asset: { code: 'XLM' }, amount: '1' }],
    memo: 'T1 delegated',
  });
  console.log('delegate-signed, hash:', built.hash);

  const res = await submitTransaction(built.xdr);
  console.log('submitted:', JSON.stringify(res));
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
