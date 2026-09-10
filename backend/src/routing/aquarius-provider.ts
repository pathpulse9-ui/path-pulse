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
import type { RoutingSwapResult } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon } from '../stellar/network.js';
import { sorobanServer, simulateAndSubmit } from '../stellar/soroban.js';
import { getManagedSigner, provisionManagedWallet } from '../stellar/managed.js';
import { fromStroops } from '../stellar/settlement.js';
import { findPath, applySlippage } from './aquarius.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';
import { routingError, type RoutingProvider } from './provider.js';

const SWAP_SOURCE_USER = '__routing_swap_source__';

function requireRouter(): string {
  const id = env.routing.aquaRouterContract;
  if (!id) {
    throw routingError(
      'AQUA_ROUTER_CONTRACT is not configured — set the Aquarius router contract address in .env',
      500,
      'ConfigError',
    );
  }
  return id;
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
  tx = (await (await getManagedSigner(SWAP_SOURCE_USER)).sign(tx)) as typeof tx;
  await horizon.submitTransaction(tx);
}

export const aquariusProvider: RoutingProvider = {
  name: 'aquarius',
  canQuote: true,
  canExecute: true,

  async quote(from, to, sourceStroops) {
    const path = await findPath(from, to, sourceStroops);
    return {
      provider: 'aquarius',
      from,
      to,
      sourceStroops,
      destinationStroops: path.destinationStroops,
      minDestinationStroops: applySlippage(path.destinationStroops),
      hops: path.pools.length,
      pools: path.pools,
      route: path.tokens,
    };
  },

  async execute(from, to, sourceStroops): Promise<RoutingSwapResult> {
    const routerId = requireRouter();
    const wallet = await provisionManagedWallet(SWAP_SOURCE_USER);
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

    const result = await simulateAndSubmit(tx, await getManagedSigner(SWAP_SOURCE_USER));

    return {
      id: `swp_${Date.now()}_${randomBytes(4).toString('hex')}`,
      provider: 'aquarius',
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
  },
};
