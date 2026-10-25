import {
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import type {
  AssetRef,
  BuildTransactionRequest,
  BuildTransactionResponse,
  SubmitTransactionResponse,
  TransactionOperation,
} from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon, submitToHorizon } from './network.js';
import { assertMainnetAllowed } from './networkGuard.js';
import { getManagedWallet, getManagedSigner, getReserveSponsor, provisionManagedWallet } from './managed.js';
import { sponsorFees } from './sponsorship.js';
import { logUpstream } from '../util/upstreamLog.js';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

function toAsset(ref: AssetRef): Asset {
  return ref.issuer ? new Asset(ref.code, ref.issuer) : Asset.native();
}

function toOperation(op: TransactionOperation) {
  switch (op.type) {
    case 'payment':
      return Operation.payment({
        destination: op.destination,
        asset: toAsset(op.asset),
        amount: op.amount,
      });
    case 'createAccount':
      return Operation.createAccount({
        destination: op.destination,
        startingBalance: op.startingBalance,
      });
    case 'changeTrust':
      return Operation.changeTrust({ asset: toAsset(op.asset), limit: op.limit });
    default:
      throw httpError(`Unsupported operation type: ${(op as { type: string }).type}`, 400, 'ValidationError');
  }
}

export async function buildTransaction(
  userId: string,
  req: Omit<BuildTransactionRequest, 'userId'>,
): Promise<BuildTransactionResponse> {
  const existing = await getManagedWallet(userId);
  const wallet = existing && !existing.provisioned ? await provisionManagedWallet(userId) : existing;
  if (!wallet || !wallet.provisioned) {
    throw httpError(
      `No provisioned managed wallet for user ${userId} — sign in first`,
      404,
      'AccountNotFound',
    );
  }

  const source = await horizon.loadAccount(wallet.address);
  const builder = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  for (const op of req.operations) builder.addOperation(toOperation(op));
  if (req.memo) builder.addMemo(Memo.text(req.memo));

  let tx = builder.setTimeout(180).build();
  tx = (await (await getManagedSigner(userId)).sign(tx)) as typeof tx;

  const envelope = env.accountFunding === 'sponsor' ? await sponsorFees(await getReserveSponsor(), tx) : tx;
  return { xdr: envelope.toXDR(), hash: envelope.hash().toString('hex') };
}

export async function submitTransaction(xdr: string): Promise<SubmitTransactionResponse> {
  assertMainnetAllowed('transaction submit');
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, env.networkPassphrase);
  } catch {
    throw httpError('Invalid transaction XDR', 400, 'ValidationError');
  }
  try {
    const res = await submitToHorizon(tx, 'transaction submit');
    return {
      hash: res.hash,
      successful: res.successful,
      ledger: res.ledger,
      horizonUrl: horizonTxUrl(res.hash),
    };
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response
      ?.data?.extras?.result_codes;
    if (!codes) logUpstream('transaction submit failed', e);
    throw httpError(
      codes ? `Horizon rejected the transaction: ${JSON.stringify(codes)}` : 'Submit failed',
      422,
      'HorizonRejected',
    );
  }
}
