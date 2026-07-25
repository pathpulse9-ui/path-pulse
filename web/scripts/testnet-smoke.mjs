// Headless testnet smoke test for the D2 payment path.
// Exercises the same code path as the UI (build tx → sign XDR → fromXDR → submit),
// substituting a local keypair for the external wallet signer, so CI can verify
// Horizon integration without a browser extension.
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

async function friendbot(pub) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
  if (!res.ok) throw new Error(`friendbot ${res.status} for ${pub}`);
}

const sender = Keypair.random();
const receiver = Keypair.random();
console.log('sender  :', sender.publicKey());
console.log('receiver:', receiver.publicKey());

console.log('funding both accounts via friendbot…');
await Promise.all([friendbot(sender.publicKey()), friendbot(receiver.publicKey())]);

const source = await server.loadAccount(sender.publicKey());
const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({
    destination: receiver.publicKey(),
    asset: Asset.native(),
    amount: '1',
  }))
  .setTimeout(180)
  .build();

// The UI hands tx.toXDR() to the wallet and gets signed XDR back; mirror that.
const unsignedXdr = tx.toXDR();
const toSign = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
toSign.sign(sender);
const signedXdr = toSign.toXDR();

const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
const res = await server.submitTransaction(signed);
console.log('submitted:', res.hash);
console.log('horizon  :', `${HORIZON_URL}/transactions/${res.hash}`);
console.log('explorer :', `https://stellar.expert/explorer/testnet/tx/${res.hash}`);

const receiverAccount = await server.loadAccount(receiver.publicKey());
const native = receiverAccount.balances.find((b) => b.asset_type === 'native');
console.log('receiver balance after payment:', native.balance, 'XLM');
if (Number(native.balance) <= 10000) throw new Error('payment not reflected');
console.log('SMOKE TEST PASSED');
