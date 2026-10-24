import { randomBytes } from 'node:crypto';
import { StellarBrokerClient, type QuoteParams, type QuoteResult } from '@stellar-broker/client';
import { Asset, FeeBumpTransaction, Transaction, type Operation } from '@stellar/stellar-sdk';
import type { RoutingSwapResult } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { horizon } from '../stellar/network.js';
import { assertMainnetAllowed } from '../stellar/networkGuard.js';
import { getManagedSigner, provisionManagedWallet } from '../stellar/managed.js';
import { logger } from '../config/logger.js';
import { fetchWithTimeout } from '../net/fetchWithTimeout.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';
import { SWAP_SOURCE_USER, ensureTrustline } from './aquarius-provider.js';
import { routingError, type ProviderQuote, type RoutingProvider } from './provider.js';

const QUOTE_TIMEOUT_MS = 15_000;
const TRADE_TIMEOUT_MS = 120_000;
export const BROKER_MAX_FEE_STROOPS = 10_000_000n;
export const BROKER_MAX_TX_LIFETIME_SECONDS = 60;

export interface BrokerTradeLimits {
  trader: string;
  selling: Asset;
  buying: Asset;
  maxSellStroops: bigint;
  minBuyStroops: bigint;
  maxFeeStroops: bigint;
  now?: () => number;
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

  function assertExpiresSoon(tx: Transaction) {
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    const nowSeconds = Math.floor((limits.now ?? Date.now)() / 1000);
    if (!maxTime) refuse('transaction has no expiry');
    if (maxTime > nowSeconds + BROKER_MAX_TX_LIFETIME_SECONDS) {
      refuse(`transaction stays valid longer than ${BROKER_MAX_TX_LIFETIME_SECONDS}s`);
    }
  }

  function assertRate(delivered: bigint, sold: bigint) {
    if (delivered * limits.maxSellStroops < limits.minBuyStroops * sold) {
      refuse(`leg delivers less than the quoted minimum of ${fromStroops(limits.minBuyStroops)} ${limits.buying.getCode()}`);
    }
  }

  function approveInner(tx: Transaction): Transaction {
    if (!tx.operations.length) refuse('transaction has no operations');
    assertExpiresSoon(tx);
    let spend = 0n;
    for (const op of tx.operations) {
      if (op.type !== 'pathPaymentStrictSend' && op.type !== 'pathPaymentStrictReceive') refuse(`unexpected ${op.type} operation`);
      const pay = op as PathPayment;
      if ((pay.source ?? tx.source) !== limits.trader) refuse('operation is not sourced from the trading account');
      if (!pay.sendAsset.equals(limits.selling)) refuse(`sends ${pay.sendAsset.getCode()} instead of ${limits.selling.getCode()}`);
      if (pay.destination !== limits.trader) refuse('operation pays an account other than the trading account');
      if (!pay.destAsset.equals(limits.buying)) refuse(`delivers ${pay.destAsset.getCode()} instead of ${limits.buying.getCode()}`);
      const sold = toStroops(pay.type === 'pathPaymentStrictSend' ? pay.sendAmount : pay.sendMax);
      const delivered = toStroops(pay.type === 'pathPaymentStrictSend' ? pay.destMin : pay.destAmount);
      assertRate(delivered, sold);
      spend += sold;
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

const BASE_RESERVE_STROOPS = 5_000_000n;

export interface HorizonBalanceView {
  balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string; selling_liabilities?: string }[];
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

export function spendableStroops(account: HorizonBalanceView, asset: Asset): bigint {
  const line = account.balances.find((b) =>
    asset.isNative()
      ? b.asset_type === 'native'
      : b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );
  if (!line) return 0n;
  let free = toStroops(line.balance) - toStroops(line.selling_liabilities ?? '0');
  if (asset.isNative()) {
    const entries = 2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0);
    free -= BigInt(entries) * BASE_RESERVE_STROOPS;
  }
  return free > 0n ? free : 0n;
}

function logBrokerTxRequests(client: StellarBrokerClient): void {
  const target = client as unknown as { processMessage: (m: { data: string }) => void };
  const original = target.processMessage.bind(client);
  target.processMessage = (message) => {
    try {
      const raw = JSON.parse(message.data) as { type?: string; hash?: string; xdr?: string; networkFee?: string };
      if (raw.type === 'tx') {
        logger.info({ brokerTx: { hash: raw.hash, xdr: raw.xdr, networkFee: raw.networkFee } }, 'stellarbroker tx request');
      }
    } catch {
      logger.warn('stellarbroker message was not JSON');
    }
    original(message);
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
      const message = String(e.error ?? 'unknown error');
      reject(
        /enough selling asset|insufficient/i.test(message)
          ? routingError(`StellarBroker refused the trade: ${message}`, 422, 'InsufficientBalance')
          : /Refused to sign/.test(message)
            ? routingError(`${message}. Nothing was signed or sent.`, 422, 'BrokerTxRefused')
            : routingError(`StellarBroker trade failed: ${message}`, 502, 'RoutingUnavailable'),
      );
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

interface DeliveredOperation {
  type: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction_successful?: boolean;
}

export function sumDelivered(ops: DeliveredOperation[], trader: string, buying: Asset): bigint {
  return ops
    .filter(
      (op) =>
        (op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') &&
        op.transaction_successful !== false &&
        op.to === trader &&
        (buying.isNative()
          ? op.asset_type === 'native'
          : op.asset_code === buying.getCode() && op.asset_issuer === buying.getIssuer()),
    )
    .reduce((sum, op) => sum + toStroops(op.amount ?? '0'), 0n);
}

async function deliveredOnChain(hashes: string[], trader: string, buying: Asset): Promise<bigint> {
  let total = 0n;
  for (const hash of hashes) {
    const ops = await horizon.operations().forTransaction(hash).limit(200).call();
    total += sumDelivered(ops.records as unknown as DeliveredOperation[], trader, buying);
  }
  return total;
}

export interface BrokerEstimate {
  status: string;
  estimatedBuyingAmount?: string;
  directTrade?: { path?: string[] };
}

export async function fetchBrokerEstimate(
  origin: string,
  query: { sellingAsset: string; buyingAsset: string; sellingAmount: string; slippageTolerance: number },
  signal?: AbortSignal,
): Promise<BrokerEstimate> {
  const search = new URLSearchParams({
    sellingAsset: query.sellingAsset,
    buyingAsset: query.buyingAsset,
    sellingAmount: query.sellingAmount,
    slippageTolerance: String(query.slippageTolerance),
  });
  let res: Response;
  try {
    res = await fetchWithTimeout(`${origin.replace(/\/+$/, '')}/quote?${search}`, { signal }, QUOTE_TIMEOUT_MS);
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e;
    logger.warn({ err: e }, 'stellarbroker quote request failed');
    throw routingError('StellarBroker quote failed', 502, 'RoutingUnavailable');
  }
  let body: BrokerEstimate;
  try {
    body = (await res.json()) as BrokerEstimate;
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e;
    throw routingError('StellarBroker quote failed', 502, 'RoutingUnavailable');
  }
  if (!res.ok && !body?.status) throw routingError('StellarBroker quote failed', 502, 'RoutingUnavailable');
  return body;
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

  async quote(from, to, sourceStroops, signal): Promise<ProviderQuote> {
    const result = await fetchBrokerEstimate(
      env.routing.stellarBroker.apiUrl,
      {
        sellingAsset: brokerAsset(from),
        buyingAsset: brokerAsset(to),
        sellingAmount: fromStroops(sourceStroops),
        slippageTolerance: env.routing.slippageBps / 10_000,
      },
      signal,
    );

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
    const selling = resolveAsset(from);
    const buying = resolveAsset(to);
    const free = spendableStroops((await horizon.loadAccount(wallet.address)) as unknown as HorizonBalanceView, selling.asset);
    if (free < sourceStroops) {
      throw routingError(
        `The swap wallet can spend ${fromStroops(free)} ${selling.ref.code}; it cannot sell ${fromStroops(sourceStroops)}`,
        422,
        'InsufficientBalance',
      );
    }
    await ensureTrustline(wallet.address, to);
    const signer = await getManagedSigner(SWAP_SOURCE_USER);
    let guard: ReturnType<typeof createBrokerGuard> | undefined;

    const client = new StellarBrokerClient({ partnerKey: env.routing.stellarBroker.partnerKey });
    logBrokerTxRequests(client);
    try {
      await client.connect();
      const quote = await waitForQuote(client, {
        sellingAsset: brokerAsset(from),
        buyingAsset: brokerAsset(to),
        sellingAmount: fromStroops(sourceStroops),
        slippageTolerance: env.routing.slippageBps / 10_000,
      });
      const estimated = toStroops(quote.estimatedBuyingAmount!);
      const tradeGuard = createBrokerGuard({
        trader: wallet.address,
        selling: selling.asset,
        buying: buying.asset,
        maxSellStroops: sourceStroops,
        minBuyStroops: applySlippage(estimated),
        maxFeeStroops: BROKER_MAX_FEE_STROOPS,
      });
      guard = tradeGuard;
      const outcome = await runTrade(client, wallet.address, async (payload) => signer.sign(tradeGuard.approve(payload)));
      const txHashes = await confirmedOnChain(tradeGuard.submittedHashes);
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
        destinationAmount: fromStroops(await deliveredOnChain(txHashes, wallet.address, buying.asset)),
        hops: quote.directTrade?.path?.length ?? 0,
        pools: [],
        txHash: txHashes[txHashes.length - 1],
        txHashes,
        horizonUrl: horizonTxUrl(txHashes[txHashes.length - 1]),
      };
    } catch (e) {
      if (guard && guard.committedSellStroops > 0n) {
        logger.error({ err: e, committed: fromStroops(guard.committedSellStroops) }, 'stellarbroker trade failed after signing');
      }
      throw e;
    } finally {
      client.close();
    }
  },
};
