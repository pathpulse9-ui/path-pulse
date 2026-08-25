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
import { horizon } from './network.js';
import { getManagedWallet, getManagedSigner } from './managed.js';

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

/**
 * Build a transaction from the caller's managed wallet and delegate-sign it.
 * The client never holds the key — the backend signs on the managed account's behalf.
 */
export async function buildTransaction(req: BuildTransactionRequest): Promise<BuildTransactionResponse> {
  const wallet = getManagedWallet(req.userId);
  if (!wallet || !wallet.provisioned) {
    throw httpError(
      `No provisioned managed wallet for user ${req.userId} — sign in first`,
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
  tx = (await getManagedSigner(req.userId).sign(tx)) as typeof tx; // delegated signing

  return { xdr: tx.toXDR(), hash: tx.hash().toString('hex') };
}

/** Submit a signed transaction envelope (managed or external-wallet) to Horizon. */
export async function submitTransaction(xdr: string): Promise<SubmitTransactionResponse> {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, env.networkPassphrase);
  } catch {
    throw httpError('Invalid transaction XDR', 400, 'ValidationError');
  }
  try {
    const res = await horizon.submitTransaction(tx);
    return {
      hash: res.hash,
      successful: res.successful,
      ledger: res.ledger,
      horizonUrl: horizonTxUrl(res.hash),
    };
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response
      ?.data?.extras?.result_codes;
    throw httpError(
      codes ? `Horizon rejected the transaction: ${JSON.stringify(codes)}` : `Submit failed: ${String(e)}`,
      422,
      'HorizonRejected',
    );
  }
}
