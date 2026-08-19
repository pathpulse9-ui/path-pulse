import { randomBytes } from 'node:crypto';
import {
  Address,
  BASE_FEE,
  Contract,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import type { RoutingQuote, RoutingSwapResult } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon } from '../stellar/network.js';
import { sorobanServer, simulateAndSubmit } from '../stellar/soroban.js';
import { getManagedSigner, provisionManagedWallet } from '../stellar/managed.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { findPath, applySlippage } from './aquarius.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';

const swapSourceUser = '__routing_swap_source__';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

function requireRouter(): string {
  const id = env.routing.aquaRouterContract;
  if (!id) {
    throw httpError(
      'AQUA_ROUTER_CONTRACT is not configured — set the Aquarius router contract address in .env',
      500,
      'ConfigError',
    );
  }
  return id;
}

export async function quoteSwap(
  from: RoutableSymbol,
  to: RoutableSymbol,
  amount: string,
): Promise<RoutingQuote> {
  const sourceStroops = toStroops(amount);
  const path = await findPath(from, to, sourceStroops);
  return {
    from: resolveAsset(from).ref,
    to: resolveAsset(to).ref,
    sourceAmount: fromStroops(sourceStroops),
    destinationAmount: fromStroops(path.destinationStroops),
    minDestinationAmount: fromStroops(applySlippage(path.destinationStroops)),
    slippageBps: env.routing.slippageBps,
    hops: path.pools.length,
    pools: path.pools,
    route: path.tokens,
  };
}

async function ensureTrustline(address: string, symbol: RoutableSymbol): Promise<void> {
  const target = resolveAsset(symbol);
  if (target.asset.isNative()) return;

  const account = await horizon.loadAccount(address);
  const has = account.balances.some(
    (b) =>
      'asset_code' in b &&
      b.asset_code === target.asset.getCode() &&
      b.asset_issuer === target.asset.getIssuer(),
  );
  if (has) return;

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  builder.addOperation(Operation.changeTrust({ asset: target.asset }));
  let tx = builder.setTimeout(180).build();
  tx = (await getManagedSigner(swapSourceUser).sign(tx)) as typeof tx;
  await horizon.submitTransaction(tx);
}

export async function executeSwap(
  from: RoutableSymbol,
  to: RoutableSymbol,
  amount: string,
): Promise<RoutingSwapResult> {
  const routerId = requireRouter();
  const sourceStroops = toStroops(amount);

  const wallet = await provisionManagedWallet(swapSourceUser);
  await ensureTrustline(wallet.address, to);

  const path = await findPath(from, to, sourceStroops);
  const minOut = applySlippage(path.destinationStroops);

  const account = await sorobanServer.getAccount(wallet.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(
      new Contract(routerId).call(
        'swap_chained',
        Address.fromString(wallet.address).toScVal(),
        xdr.ScVal.fromXDR(path.swapChainXdr, 'base64'),
        Address.fromString(resolveAsset(from).contractId).toScVal(),
        nativeToScVal(sourceStroops, { type: 'u128' }),
        nativeToScVal(minOut, { type: 'u128' }),
      ),
    )
    .setTimeout(180)
    .build();

  const result = await simulateAndSubmit(tx, getManagedSigner(swapSourceUser));

  return {
    id: `swp_${Date.now()}_${randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    network: env.network,
    sourceAddress: wallet.address,
    from: resolveAsset(from).ref,
    to: resolveAsset(to).ref,
    sourceAmount: fromStroops(sourceStroops),
    estimatedDestinationAmount: fromStroops(path.destinationStroops),
    minDestinationAmount: fromStroops(minOut),
    hops: path.pools.length,
    pools: path.pools,
    txHash: result.hash,
    horizonUrl: horizonTxUrl(result.hash),
  };
}
