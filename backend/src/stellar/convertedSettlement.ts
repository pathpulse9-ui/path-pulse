import { BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { CreateConvertedSettlementRequest, SettlementBatch } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { executeSwap } from '../routing/aggregator.js';
import { resolveAsset } from '../routing/assets.js';
import { SWAP_SOURCE_USER } from '../routing/aquarius-provider.js';
import { getManagedSigner, provisionManagedWallet, RESERVE_SPONSOR_USER } from './managed.js';
import { horizon, submitToHorizon } from './network.js';
import { assertMainnetAllowed } from './networkGuard.js';
import { executeSettlementBatch, fromStroops, toStroops } from './settlement.js';

const SETTLEMENT_SOURCE_USER = RESERVE_SPONSOR_USER;

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

async function heldStroops(address: string, code: string, issuer?: string): Promise<bigint> {
  const account = await horizon.loadAccount(address);
  const line = account.balances.find((b) =>
    issuer
      ? 'asset_code' in b && b.asset_code === code && b.asset_issuer === issuer
      : b.asset_type === 'native',
  );
  return line ? toStroops(Number(line.balance).toFixed(7)) : 0n;
}

export async function executeConvertedSettlement(
  req: CreateConvertedSettlementRequest,
  opts: { createdBy?: string } = {},
): Promise<SettlementBatch> {
  assertMainnetAllowed('converted settlement');
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  const target = resolveAsset(env.routing.settlementAssetCode);
  if (resolveAsset(req.from).ref.code === target.ref.code) {
    throw httpError(`${req.from} is already the settlement asset — use POST /v1/settlement/batches`, 400, 'ValidationError');
  }

  const swapSource = await provisionManagedWallet(SWAP_SOURCE_USER);
  const settlementSource = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const before = await heldStroops(swapSource.address, target.ref.code, target.ref.issuer);
  const swap = await executeSwap(req.from, env.routing.settlementAssetCode, req.amount);
  const converted = (await heldStroops(swapSource.address, target.ref.code, target.ref.issuer)) - before;
  if (converted <= 0n) {
    throw httpError(`Swap ${swap.txHash} delivered no ${target.ref.code} to the routing source`, 502, 'RoutingUnavailable');
  }
  const convertedAmount = fromStroops(converted);

  const transfer = new TransactionBuilder(await horizon.loadAccount(swapSource.address), {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(Operation.payment({ destination: settlementSource.address, asset: target.asset, amount: convertedAmount }))
    .setTimeout(120)
    .build();
  const signed = await (await getManagedSigner(SWAP_SOURCE_USER)).sign(transfer);
  const moved = await submitToHorizon(signed, 'converted funds transfer');

  const conversion: SettlementBatch['conversion'] = {
    provider: swap.provider,
    from: swap.from,
    sourceAmount: swap.sourceAmount,
    convertedAmount,
    swapTxHashes: swap.txHashes ?? [swap.txHash],
    transferTxHash: moved.hash,
  };

  try {
    return await executeSettlementBatch(
      { grossAmount: convertedAmount, asset: target.ref, drivers: req.drivers, depositTxHash: moved.hash },
      { createdBy: opts.createdBy, conversion },
    );
  } catch (e) {
    logger.error({ err: e, conversion }, 'converted funds moved to the settlement source but the settlement failed');
    throw httpError(
      `Converted ${convertedAmount} ${target.ref.code} reached the settlement source (tx ${moved.hash}) but the ` +
        `settlement failed: ${(e as Error).message}. Retry POST /v1/settlement/batches with depositTxHash ${moved.hash}.`,
      502,
      'SettlementAfterConversionFailed',
    );
  }
}
