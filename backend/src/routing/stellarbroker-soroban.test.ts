import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Asset,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { CustodialSigner } from '../stellar/signing.js';
import {
  BROKER_ROUTER,
  authoriseBrokerInvocation,
  createBrokerGuard,
  isSorobanTx,
  sumDelivered,
} from './stellarbroker-provider.js';

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'stellarbroker-soroban.fixture.json'), 'utf8')) as {
  xdr: string;
  networkFee: string;
};
const RESERVE = 'GBSSPUA6OJT75YB5ONGUWIBM5P5PTVJO2FTC5E45TKFQUVSF55SDS3FV';
const USDC = new Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
const XLM = Asset.native();

const load = () => TransactionBuilder.fromXDR(fixture.xdr, Networks.PUBLIC) as Transaction;
const issuedAt = () => (Number(load().timeBounds!.maxTime) - 30) * 1000;

const limits = (over: Partial<Parameters<typeof createBrokerGuard>[0]> = {}) => ({
  trader: RESERVE,
  selling: USDC,
  buying: XLM,
  maxSellStroops: 10_000_000n,
  minBuyStroops: 58_000_000n,
  maxFeeStroops: 10_000_000n,
  networkPassphrase: Networks.PUBLIC,
  maxAuthLedger: load().ledgerBounds!.maxLedger,
  now: issuedAt,
  ...over,
});

function withTransferAmount(tx: Transaction, amount: bigint): Transaction {
  const envelope = tx.toEnvelope();
  const entry = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().auth()[0];
  const transfer = entry.rootInvocation().subInvocations()[0].function().contractFn();
  const args = transfer.args();
  args[2] = nativeToScVal(amount, { type: 'i128' });
  transfer.args(args);
  return new Transaction(envelope, Networks.PUBLIC);
}

function withRouteMin(tx: Transaction, min: bigint): Transaction {
  const envelope = tx.toEnvelope();
  const op = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const setMin = (call: xdr.InvokeContractArgs) => {
    const args = call.args();
    const entry = args[1].vec()![0].map()!.find((e) => e.key().sym().toString() === 'min')!;
    entry.val(nativeToScVal(min, { type: 'i128' }));
    call.args(args);
  };
  setMin(op.hostFunction().invokeContract());
  setMin(op.auth()[0].rootInvocation().function().contractFn());
  return new Transaction(envelope, Networks.PUBLIC);
}

test('the captured StellarBroker request is a Soroban router swap from the reserve', () => {
  const tx = load();
  assert.equal(isSorobanTx(tx), true);
  const op = tx.operations[0] as unknown as { source: string; func: xdr.HostFunction };
  assert.equal(op.source, RESERVE);
  assert.equal(op.func.invokeContract().functionName().toString(), 'swap');
});

test('the guard approves the real router swap within the requested amount and minimum', () => {
  const guard = createBrokerGuard(limits());
  assert.doesNotThrow(() => guard.approveSoroban(load()));
  assert.equal(guard.committedSellStroops, 10_000_000n);
});

test('the guard refuses when the swap sells more than requested', () => {
  const guard = createBrokerGuard(limits({ maxSellStroops: 9_999_999n }));
  assert.throws(() => guard.approveSoroban(load()), /would sell more than/);
});

test('the guard refuses when the routes promise less than the quoted minimum', () => {
  const guard = createBrokerGuard(limits({ minBuyStroops: 60_000_000n }));
  assert.throws(() => guard.approveSoroban(load()), /less than the quoted minimum/);
});

test('the guard refuses a swap for another trading account', () => {
  const guard = createBrokerGuard(limits({ trader: Keypair.random().publicKey() }));
  assert.throws(() => guard.approveSoroban(load()), /not sourced from the trading account/);
});

test('the guard refuses the wrong asset pair', () => {
  assert.throws(() => createBrokerGuard(limits({ selling: XLM, buying: USDC })).approveSoroban(load()), /sells something other/);
});

test('the guard refuses an authorisation valid for too many ledgers', () => {
  const guard = createBrokerGuard(limits({ maxAuthLedger: load().ledgerBounds!.maxLedger - 1 }));
  assert.throws(() => guard.approveSoroban(load()), /too many ledgers/);
});

test('the guard refuses an expired or long-lived transaction', () => {
  const late = createBrokerGuard(limits({ now: () => (Number(load().timeBounds!.maxTime) - 3600) * 1000 }));
  assert.throws(() => late.approveSoroban(load()), /stays valid longer/);
});

test('the guard refuses an authorised transfer larger than the routed amount', () => {
  const guard = createBrokerGuard(limits({ maxSellStroops: 20_000_000n }));
  assert.throws(() => guard.approveSoroban(withTransferAmount(load(), 20_000_000n)), /does not match the routed amount/);
});

test('the router address is pinned', () => {
  assert.equal(BROKER_ROUTER, 'CASH5JQCCHHKSZXFTDP7V2FLUJYMENUXZJTE65ORQLKJPFZLEZ5FRNGA');
});

test('the invocation is signed by the signer key, not the account master key, over the exact preimage', async () => {
  const signerKey = Keypair.random();
  const signer = new CustodialSigner(signerKey);
  const original = load();
  const authorised = await authoriseBrokerInvocation(original, signer, Networks.PUBLIC);

  const op = authorised.operations[0] as unknown as { auth: xdr.SorobanAuthorizationEntry[] };
  const credentials = op.auth[0].credentials().address();
  assert.equal(credentials.signatureExpirationLedger(), original.ledgerBounds!.maxLedger + 1);
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.PUBLIC)),
      nonce: credentials.nonce(),
      invocation: op.auth[0].rootInvocation(),
      signatureExpirationLedger: credentials.signatureExpirationLedger(),
    }),
  );
  const [entry] = scValToNative(credentials.signature()) as { public_key: Buffer; signature: Buffer }[];
  assert.deepEqual(Buffer.from(entry.public_key), signerKey.rawPublicKey());
  assert.equal(signerKey.verify(hash(preimage.toXDR()), Buffer.from(entry.signature)), true);

  const guard = createBrokerGuard(limits());
  guard.approveSoroban(original);
  assert.doesNotThrow(() => guard.approveSorobanSigned(authorised));
});

test('a fee bump of the signed swap is approved only after the swap itself was approved', async () => {
  const signer = new CustodialSigner(Keypair.random());
  const authorised = await authoriseBrokerInvocation(load(), signer, Networks.PUBLIC);
  const bump = () => TransactionBuilder.buildFeeBumpTransaction(RESERVE, fixture.networkFee, authorised, Networks.PUBLIC);

  assert.throws(() => createBrokerGuard(limits()).approve(bump()), /unapproved transaction/);

  const guard = createBrokerGuard(limits());
  guard.approveSoroban(load());
  guard.approveSorobanSigned(authorised);
  assert.doesNotThrow(() => guard.approve(bump()));
  assert.equal(guard.submittedHashes.length, 1);
});

test('two legs approved in parallel are each signed against their own approval', async () => {
  const signer = new CustodialSigner(Keypair.random());
  const guard = createBrokerGuard(limits({ maxSellStroops: 20_000_000n }));
  const first = load();
  const second = withRouteMin(load(), 58_100_000n);
  guard.approveSoroban(first);
  guard.approveSoroban(second);
  const [signedFirst, signedSecond] = await Promise.all([
    authoriseBrokerInvocation(first, signer, Networks.PUBLIC),
    authoriseBrokerInvocation(second, signer, Networks.PUBLIC),
  ]);
  assert.doesNotThrow(() => guard.approveSorobanSigned(signedFirst));
  assert.doesNotThrow(() => guard.approveSorobanSigned(signedSecond));
  assert.equal(guard.committedSellStroops, 20_000_000n);
  assert.throws(() => guard.approveSorobanSigned(signedFirst), /differs from the approved one/);
});

test('the same contract call cannot be approved twice while it awaits signature', () => {
  const guard = createBrokerGuard(limits({ maxSellStroops: 20_000_000n }));
  guard.approveSoroban(load());
  assert.throws(() => guard.approveSoroban(load()), /already awaiting signature/);
  assert.equal(guard.committedSellStroops, 10_000_000n);
});

test('the signed swap must match the approved one', async () => {
  const signer = new CustodialSigner(Keypair.random());
  const guard = createBrokerGuard(limits({ maxSellStroops: 30_000_000n }));
  guard.approveSoroban(load());
  const other = await authoriseBrokerInvocation(withTransferAmount(load(), 20_000_000n), signer, Networks.PUBLIC);
  assert.throws(() => guard.approveSorobanSigned(other));
});

test('delivered output counts Soroban balance changes paid to the trader in the buying asset', () => {
  const delivered = sumDelivered(
    [
      {
        type: 'invoke_host_function',
        asset_balance_changes: [
          { type: 'transfer', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: USDC.getIssuer(), to: BROKER_ROUTER, amount: '1.0000000' },
          { type: 'transfer', asset_type: 'native', to: RESERVE, amount: '5.8500000' },
          { type: 'transfer', asset_type: 'native', to: Keypair.random().publicKey(), amount: '0.0100000' },
        ],
      },
    ],
    RESERVE,
    XLM,
  );
  assert.equal(delivered, 58_500_000n);
});
