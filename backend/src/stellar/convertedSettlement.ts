import { BASE_FEE, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { CreateConvertedSettlementRequest, SettlementBatch, SettlementDeposit } from '@pathpulse/contract';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { executeSwap } from '../routing/aggregator.js';
import { withSwapLock } from '../routing/swapLock.js';
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

export function executeConvertedSettlement(
  req: CreateConvertedSettlementRequest,
  opts: { createdBy?: string; approvedBy?: string } = {},
): Promise<SettlementBatch> {
  return withSwapLock(() => runConvertedSettlement(req, opts));
}

async function runConvertedSettlement(
  req: CreateConvertedSettlementRequest,
  opts: { createdBy?: string; approvedBy?: string },
): Promise<SettlementBatch> {
  assertMainnetAllowed('converted settlement');
  if (!req.drivers?.length) throw httpError('drivers must be a non-empty array', 400, 'ValidationError');
  const target = resolveAsset(env.routing.settlementAssetCode);
  if (resolveAsset(req.from).ref.code === target.ref.code) {
    throw httpError(`${req.from} is already the settlement asset — use POST /v1/settlement/batches`, 400, 'ValidationError');
  }

  const swapSource = await provisionManagedWallet(SWAP_SOURCE_USER);
  const settlementSource = await provisionManagedWallet(SETTLEMENT_SOURCE_USER);
  const swap = await executeSwap(req.from, env.routing.settlementAssetCode, req.amount, req.provider);
  if (!swap.destinationAmount) {
    throw httpError(
      `Swap ${swap.txHash} reported no output amount — refusing to settle from a balance estimate`,
      502,
      'RoutingUnavailable',
    );
  }
  const converted = toStroops(swap.destinationAmount);
  if (converted <= 0n) {
    throw httpError(`Swap ${swap.txHash} delivered no ${target.ref.code} to the routing source`, 502, 'RoutingUnavailable');
  }
  const convertedAmount = fromStroops(converted);

  let transferTxHash: string | undefined;
  if (swapSource.address !== settlementSource.address) {
    const transfer = new TransactionBuilder(await horizon.loadAccount(swapSource.address), {
      fee: BASE_FEE,
      networkPassphrase: env.networkPassphrase,
    })
      .addOperation(Operation.payment({ destination: settlementSource.address, asset: target.asset, amount: convertedAmount }))
      .setTimeout(120)
      .build();
    const signed = await (await getManagedSigner(SWAP_SOURCE_USER)).sign(transfer);
    transferTxHash = (await submitToHorizon(signed, 'converted funds transfer')).hash;
  }

  const conversion: SettlementBatch['conversion'] = {
    provider: swap.provider,
    from: swap.from,
    sourceAmount: swap.sourceAmount,
    convertedAmount,
    swapTxHashes: swap.txHashes ?? [swap.txHash],
    transferTxHash,
  };
  const fundedBy: SettlementDeposit = {
    txHash: transferTxHash ?? swap.txHash,
    from: swapSource.address,
    amount: convertedAmount,
    receivedAt: new Date().toISOString(),
  };

  try {
    return await executeSettlementBatch(
      { grossAmount: convertedAmount, asset: target.ref, drivers: req.drivers },
      { createdBy: opts.createdBy, approvedBy: opts.approvedBy, conversion, fundedBy },
    );
  } catch (e) {
    logger.error({ err: e, conversion }, 'converted funds reached the settlement source but the settlement failed');
    const failure = httpError(
      `Converted ${convertedAmount} ${target.ref.code} reached the settlement source (tx ${fundedBy.txHash}) but the ` +
        `settlement failed (${(e as Error).name}). The converted funds stay in the settlement source; an operator ` +
        'must settle them from a treasury deposit.',
      502,
      'SettlementAfterConversionFailed',
    ) as Error & { keepIdempotencyKey: boolean };
    failure.keepIdempotencyKey = true;
    throw failure;
  }
}
