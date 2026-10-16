import { randomBytes } from 'node:crypto';
import { estimateSwap, StellarBrokerClient, type QuoteParams, type QuoteResult } from '@stellar-broker/client';
import { Asset, FeeBumpTransaction, Transaction, type Operation } from '@stellar/stellar-sdk';
import type { RoutingSwapResult } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { horizon } from '../stellar/network.js';
import { assertMainnetAllowed } from '../stellar/networkGuard.js';
import { getManagedSigner, provisionManagedWallet } from '../stellar/managed.js';
import { logger } from '../config/logger.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';
import { SWAP_SOURCE_USER, ensureTrustline } from './aquarius-provider.js';
import { routingError, type ProviderQuote, type RoutingProvider } from './provider.js';

const QUOTE_TIMEOUT_MS = 15_000;
const TRADE_TIMEOUT_MS = 120_000;
export const BROKER_MAX_FEE_STROOPS = 10_000_000n;

export interface BrokerTradeLimits {
  trader: string;
  selling: Asset;
  buying: Asset;
  maxSellStroops: bigint;
  maxFeeStroops: bigint;
}

function refuse(reason: string): never {
  throw routingError(`Refused to sign StellarBroker transaction: ${reason}`, 422, 'BrokerTxRefused');
}

type PathPayment = Operation.PathPaymentStrictSend | Operation.PathPaymentStrictReceive;

export function createBrokerGuard(limits: BrokerTradeLimits) {
  let committedSell = 0n;
  let committedFees = 0n;
  const approvedInner = new Set<string>();
  const submitted: string[] = [];

  function chargeFee(fee: string) {
    committedFees += BigInt(fee);
    if (committedFees > limits.maxFeeStroops) refuse(`network fees would exceed ${fromStroops(limits.maxFeeStroops)} XLM`);
  }

  function approveInner(tx: Transaction): Transaction {
    if (!tx.operations.length) refuse('transaction has no operations');
    let spend = 0n;
    for (const op of tx.operations) {
      if (op.type !== 'pathPaymentStrictSend' && op.type !== 'pathPaymentStrictReceive') refuse(`unexpected ${op.type} operation`);
      const pay = op as PathPayment;
      if ((pay.source ?? tx.source) !== limits.trader) refuse('operation is not sourced from the trading account');
      if (!pay.sendAsset.equals(limits.selling)) refuse(`sends ${pay.sendAsset.getCode()} instead of ${limits.selling.getCode()}`);
      const toTrader = pay.destination === limits.trader;
      if (toTrader && !pay.destAsset.equals(limits.buying)) refuse(`delivers ${pay.destAsset.getCode()} instead of ${limits.buying.getCode()}`);
      if (!toTrader && pay.type !== 'pathPaymentStrictSend') refuse('fee payment must be strict-send');
      spend += toStroops(pay.type === 'pathPaymentStrictSend' ? pay.sendAmount : pay.sendMax);
    }
    if (committedSell + spend > limits.maxSellStroops) {
      refuse(`would sell more than the ${fromStroops(limits.maxSellStroops)} ${limits.selling.getCode()} requested`);
    }
    if (tx.source === limits.trader) chargeFee(tx.fee);
    committedSell += spend;
    approvedInner.add(tx.hash().toString('hex'));
    return tx;
  }

  function approveFeeBump(tx: FeeBumpTransaction): FeeBumpTransaction {
    if (tx.feeSource !== limits.trader) refuse('fee bump is not paid by the trading account');
    if (!approvedInner.has(tx.innerTransaction.hash().toString('hex'))) refuse('fee bump wraps an unapproved transaction');
    chargeFee(tx.fee);
    submitted.push(tx.hash().toString('hex'));
    return tx;
  }

  return {
    approve(payload: unknown): Transaction | FeeBumpTransaction {
      if (payload instanceof FeeBumpTransaction) return approveFeeBump(payload);
      if (payload instanceof Transaction) return approveInner(payload);
      return refuse('raw authorization payloads (Soroban routes) are not signed');
    },
    get committedSellStroops() {
      return committedSell;
    },
    get submittedHashes() {
      return [...submitted];
    },
  };
}

function waitForQuote(client: StellarBrokerClient, params: QuoteParams): Promise<QuoteResult> {
  return new Promise((resolve, reject) => {
    let lastError = 'no quote received';
    const timer = setTimeout(() => {
      client.off('quote', onQuote);
      reject(routingError(`StellarBroker: ${lastError}`, 422, 'NoRoute'));
    }, QUOTE_TIMEOUT_MS);
    function onQuote(e: Event & { quote?: QuoteResult }) {
      const q = e.quote;
      if (!q) return;
      if (q.status === 'success' && q.estimatedBuyingAmount) {
        clearTimeout(timer);
        client.off('quote', onQuote);
        resolve(q);
        return;
      }
      lastError = (q as { error?: string }).error ?? q.status;
    }
    client.on('quote', onQuote);
    client.quote(params);
  });
}

interface TradeOutcome {
  status: string;
  sold: string;
  bought: string;
}

function runTrade(client: StellarBrokerClient, trader: string, sign: (p: unknown) => Promise<unknown>): Promise<TradeOutcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.stop();
      reject(routingError('StellarBroker trade did not finish in time', 504, 'RoutingTimeout'));
    }, TRADE_TIMEOUT_MS);
    client.once('finished', (e: Event & { result?: TradeOutcome }) => {
      clearTimeout(timer);
      resolve(e.result ?? { status: 'unknown', sold: '0', bought: '0' });
    });
    client.once('error', (e: Event & { error?: unknown }) => {
      clearTimeout(timer);
      client.stop();
      reject(routingError(`StellarBroker trade failed: ${String(e.error ?? 'unknown error')}`, 502, 'RoutingUnavailable'));
    });
    client.confirmQuote(trader, sign as never);
  });
}

async function confirmedOnChain(hashes: string[]): Promise<string[]> {
  const landed: string[] = [];
  for (const hash of hashes) {
    try {
      const record = await horizon.transactions().transaction(hash).call();
      if (record.successful) landed.push(hash);
    } catch {
      continue;
    }
  }
  return landed;
}

function brokerAsset(symbol: RoutableSymbol): string {
  const { ref } = resolveAsset(symbol);
  return ref.issuer ? `${ref.code}-${ref.issuer}` : 'XLM';
}

function applySlippage(stroops: bigint): bigint {
  const bps = BigInt(env.routing.slippageBps);
  return (stroops * (10_000n - bps)) / 10_000n;
}

export const stellarBrokerProvider: RoutingProvider = {
  name: 'stellarbroker',
  canQuote: true,
  get canExecute() {
    return env.network === 'mainnet';
  },

  async quote(from, to, sourceStroops): Promise<ProviderQuote> {
    const params = {
      sellingAsset: brokerAsset(from),
      buyingAsset: brokerAsset(to),
      sellingAmount: fromStroops(sourceStroops),
      slippageTolerance: env.routing.slippageBps / 10_000,
      origin: env.routing.stellarBroker.apiUrl,
    } as QuoteParams;

    let result;
    try {
      result = await estimateSwap(params);
    } catch (e) {
      const code = (e as { code?: number }).code;
      throw routingError(
        `StellarBroker quote failed: ${(e as Error).message ?? String(e)}`,
        code ? 422 : 502,
        code ? 'NoRoute' : 'RoutingUnavailable',
      );
    }

    if (result.status !== 'success' || !result.estimatedBuyingAmount) {
      throw routingError(`StellarBroker: no route for ${from} → ${to} (${result.status})`, 422, 'NoRoute');
    }

    const destinationStroops = toStroops(result.estimatedBuyingAmount);
    const route = result.directTrade?.path ?? [];
    return {
      provider: 'stellarbroker',
      from,
      to,
      sourceStroops,
      destinationStroops,
      minDestinationStroops: applySlippage(destinationStroops),
      hops: route.length,
      pools: [],
      route,
    };
  },

  async execute(from, to, sourceStroops): Promise<RoutingSwapResult> {
    if (env.network !== 'mainnet') throw routingError('StellarBroker trades on mainnet only', 422, 'NoRoute');
    assertMainnetAllowed('stellarbroker swap');
    const wallet = await provisionManagedWallet(SWAP_SOURCE_USER);
    await ensureTrustline(wallet.address, to);
    const signer = await getManagedSigner(SWAP_SOURCE_USER);
    const selling = resolveAsset(from);
    const buying = resolveAsset(to);
    const guard = createBrokerGuard({
      trader: wallet.address,
      selling: selling.asset,
      buying: buying.asset,
      maxSellStroops: sourceStroops,
      maxFeeStroops: BROKER_MAX_FEE_STROOPS,
    });

    const client = new StellarBrokerClient({ partnerKey: env.routing.stellarBroker.partnerKey });
    try {
      await client.connect();
      const quote = await waitForQuote(client, {
        sellingAsset: brokerAsset(from),
        buyingAsset: brokerAsset(to),
        sellingAmount: fromStroops(sourceStroops),
        slippageTolerance: env.routing.slippageBps / 10_000,
      });
      const estimated = toStroops(quote.estimatedBuyingAmount!);
      const outcome = await runTrade(client, wallet.address, async (payload) => signer.sign(guard.approve(payload)));
      const txHashes = await confirmedOnChain(guard.submittedHashes);
      if (outcome.status !== 'success' || !txHashes.length) {
        throw routingError(
          `StellarBroker trade ended "${outcome.status}" after selling ${outcome.sold} ${selling.ref.code}`,
          502,
          'RoutingUnavailable',
        );
      }
      return {
        id: `swp_${Date.now()}_${randomBytes(4).toString('hex')}`,
        provider: 'stellarbroker',
        createdAt: new Date().toISOString(),
        network: env.network,
        sourceAddress: wallet.address,
        from: selling.ref,
        to: buying.ref,
        sourceAmount: outcome.sold,
        estimatedDestinationAmount: fromStroops(estimated),
        minDestinationAmount: fromStroops(applySlippage(estimated)),
        destinationAmount: outcome.bought,
        hops: quote.directTrade?.path?.length ?? 0,
        pools: [],
        txHash: txHashes[txHashes.length - 1],
        txHashes,
        horizonUrl: horizonTxUrl(txHashes[txHashes.length - 1]),
      };
    } catch (e) {
      if (guard.committedSellStroops > 0n) {
        logger.error({ err: e, committed: fromStroops(guard.committedSellStroops) }, 'stellarbroker trade failed after signing');
      }
      throw e;
    } finally {
      client.close();
    }
  },
};
