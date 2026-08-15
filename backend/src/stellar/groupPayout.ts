import { randomBytes } from 'node:crypto';
import { TransactionBuilder, Operation, Asset, BASE_FEE, StrKey } from '@stellar/stellar-sdk';
import type {
  CreateGroupPayoutRequest,
  GroupPayoutBatch,
  GroupPayoutBatchPage,
  AssetRef,
} from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon } from './network.js';
import { provisionManagedWallet, getManagedSigner } from './managed.js';
import { toStroops, fromStroops } from './settlement.js';

/**
 * Flat bulk payout (D9 — CSV/Excel group payment). Unlike the 50/30/20
 * settlement engine, every recipient is paid the exact amount supplied —
 * no tier multiplier, no split. Same dev-tier managed source pattern as
 * the settlement engine: funded via Friendbot, testnet only.
 */

const GROUP_PAYOUT_SOURCE_USER = '__group_payout_source__';
const MAX_RECIPIENTS = 100; // Stellar tx operation limit

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

function assetOf(ref?: AssetRef): { asset: Asset; ref: AssetRef } {
  if (!ref || !ref.issuer) return { asset: Asset.native(), ref: { code: 'XLM' } };
  return { asset: new Asset(ref.code, ref.issuer), ref };
}

const batches: GroupPayoutBatch[] = [];

export async function executeGroupPayout(req: CreateGroupPayoutRequest): Promise<GroupPayoutBatch> {
  if (!req.recipients?.length) throw httpError('recipients must be a non-empty array', 400, 'ValidationError');
  if (req.recipients.length > MAX_RECIPIENTS) {
    throw httpError(`recipients exceeds max of ${MAX_RECIPIENTS} per batch`, 400, 'ValidationError');
  }
  for (const r of req.recipients) {
    if (!StrKey.isValidEd25519PublicKey(r.address)) {
      throw httpError(`Invalid Stellar address for "${r.name}": ${r.address}`, 400, 'ValidationError');
    }
  }

  const source = await provisionManagedWallet(GROUP_PAYOUT_SOURCE_USER);
  const { asset, ref } = assetOf(req.asset);

  const account = await horizon.loadAccount(source.address);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  let totalStroops = 0n;
  for (const r of req.recipients) {
    const stroops = toStroops(r.amount);
    totalStroops += stroops;
    builder.addOperation(Operation.payment({ destination: r.address, asset, amount: fromStroops(stroops) }));
  }

  let tx = builder.setTimeout(180).build();
  tx = (await getManagedSigner(GROUP_PAYOUT_SOURCE_USER).sign(tx)) as typeof tx;

  let res;
  try {
    res = await horizon.submitTransaction(tx);
  } catch (e: unknown) {
    const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } })?.response?.data?.extras
      ?.result_codes;
    throw httpError(
      codes ? `Group payout rejected by Horizon: ${JSON.stringify(codes)}` : `Group payout submit failed: ${String(e)}`,
      422,
      'HorizonRejected',
    );
  }

  const batch: GroupPayoutBatch = {
    id: `grp_${Date.now()}_${randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    network: env.network,
    asset: ref,
    totalAmount: fromStroops(totalStroops),
    sourceAddress: source.address,
    receipts: req.recipients.map((r) => ({ name: r.name, address: r.address, amount: r.amount })),
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
  };
  batches.unshift(batch);
  return batch;
}

export function listGroupPayoutBatches(cursor?: string, limit = 50): GroupPayoutBatchPage {
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = batches.slice(start, start + size);
  const next = start + size < batches.length ? String(start + size) : null;
  return { items, nextCursor: next };
}

export function getGroupPayoutBatch(id: string): GroupPayoutBatch {
  const b = batches.find((x) => x.id === id);
  if (!b) throw httpError(`Group payout batch ${id} not found`, 404, 'NotFound');
  return b;
}
