import type { AssetRef, SettlementDeposit } from '@pathpulse/contract';
import { horizon } from './network.js';
import { fromStroops, toStroops } from './settlement.js';

const PAYMENT_TYPES = new Set(['payment', 'path_payment_strict_send', 'path_payment_strict_receive']);

export interface DepositOperation {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

function depositError(message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = 'DepositInvalid';
  e.status = 422;
  return e;
}

function sameAsset(op: DepositOperation, ref: AssetRef): boolean {
  if (!ref.issuer) return op.asset_type === 'native';
  return op.asset_code === ref.code && op.asset_issuer === ref.issuer;
}

export function matchDeposit(
  ops: DepositOperation[],
  destination: string,
  ref: AssetRef,
  minAmount: string,
  allowedSenders?: string[],
): { from: string; amount: string } {
  const paying = ops.filter((op) => PAYMENT_TYPES.has(op.type) && op.to === destination && sameAsset(op, ref));
  if (!paying.length) {
    throw depositError(`Deposit transaction pays no ${ref.code} into the settlement source ${destination}`);
  }
  const matching = allowedSenders ? paying.filter((op) => op.from && allowedSenders.includes(op.from)) : paying;
  if (!matching.length) {
    throw depositError(`Deposit was not paid by the treasury or the routing source (${allowedSenders!.join(', ')})`);
  }
  const total = matching.reduce((sum, op) => sum + toStroops(op.amount ?? '0'), 0n);
  if (total < toStroops(minAmount)) {
    throw depositError(`Deposit of ${fromStroops(total)} ${ref.code} is less than the ${minAmount} being settled`);
  }
  const senders = [...new Set(matching.map((op) => op.from ?? ''))].filter(Boolean);
  return { from: senders.join(', '), amount: fromStroops(total) };
}

export async function verifyDeposit(
  txHash: string,
  destination: string,
  ref: AssetRef,
  minAmount: string,
  allowedSenders?: string[],
): Promise<SettlementDeposit> {
  let tx;
  try {
    tx = await horizon.transactions().transaction(txHash).call();
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      throw depositError(`Deposit transaction ${txHash} was not found on this network`);
    }
    throw e;
  }
  if (!tx.successful) throw depositError(`Deposit transaction ${txHash} failed on-chain`);
  const ops = await horizon.operations().forTransaction(txHash).limit(200).call();
  const { from, amount } = matchDeposit(
    ops.records as unknown as DepositOperation[],
    destination,
    ref,
    minAmount,
    allowedSenders,
  );
  return { txHash, from, amount, receivedAt: new Date(tx.created_at).toISOString() };
}
