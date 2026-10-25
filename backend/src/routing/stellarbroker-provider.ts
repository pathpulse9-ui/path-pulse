import { randomBytes } from 'node:crypto';
import { StellarBrokerClient, type QuoteParams, type QuoteResult } from '@stellar-broker/client';
import {
  Address,
  Asset,
  FeeBumpTransaction,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
  Operation,
} from '@stellar/stellar-sdk';
import type { Signer } from '../stellar/signing.js';
import type { RoutingSwapResult } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { toStroops, fromStroops } from '../stellar/settlement.js';
import { horizon, submitToHorizon } from '../stellar/network.js';
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
export const BROKER_ROUTER = 'CASH5JQCCHHKSZXFTDP7V2FLUJYMENUXZJTE65ORQLKJPFZLEZ5FRNGA';
export const BROKER_MAX_AUTH_LEDGERS = 60;

export interface BrokerTradeLimits {
  trader: string;
  selling: Asset;
  buying: Asset;
  maxSellStroops: bigint;
  minBuyStroops: bigint;
  maxFeeStroops: bigint;
  networkPassphrase: string;
  maxAuthLedger: number;
  now?: () => number;
}

interface BrokerRoute {
  amount?: unknown;
  min?: unknown;
  path?: { asset?: unknown }[];
}

const contractOf = (fn: xdr.InvokeContractArgs) => Address.fromScAddress(fn.contractAddress()).toString();
const nativeArgs = (fn: xdr.InvokeContractArgs) => fn.args().map((a) => scValToNative(a) as unknown);

export function isSorobanTx(tx: Transaction): boolean {
  const op = tx.operations[0] as { auth?: unknown[] } | undefined;
  return (op?.auth?.length ?? 0) > 0;
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

  function checkSorobanSwap(tx: Transaction): bigint {
    if (tx.operations.length !== 1) refuse('a Soroban swap must be a single operation');
    const op = tx.operations[0] as Operation.InvokeHostFunction;
    if (op.type !== 'invokeHostFunction') refuse(`unexpected ${op.type} operation`);
    if (op.source !== limits.trader) refuse('the contract call is not sourced from the trading account');
    assertExpiresSoon(tx);
    const maxLedger = tx.ledgerBounds?.maxLedger ?? 0;
    if (!maxLedger || maxLedger > limits.maxAuthLedger) refuse('the authorisation would stay valid for too many ledgers');
    if (op.func.switch().name !== 'hostFunctionTypeInvokeContract') refuse('the host function is not a contract call');
    const call = op.func.invokeContract();
    if (contractOf(call) !== BROKER_ROUTER) refuse(`contract ${contractOf(call)} is not the StellarBroker router`);
    if (call.functionName().toString() !== 'swap') refuse(`router function ${call.functionName().toString()} is not swap`);

    const sellingSac = limits.selling.contractId(limits.networkPassphrase);
    const buyingSac = limits.buying.contractId(limits.networkPassphrase);
    const args = nativeArgs(call);
    if (args[0] !== sellingSac) refuse(`the router call sells something other than ${limits.selling.getCode()}`);
    if (args[2] !== limits.trader) refuse('the router call pays an account other than the trading account');
    const routes = args[1] as BrokerRoute[];
    if (!Array.isArray(routes) || !routes.length) refuse('the router call has no routes');
    let sold = 0n;
    let minOut = 0n;
    for (const route of routes) {
      if (typeof route.amount !== 'bigint' || typeof route.min !== 'bigint' || route.amount <= 0n || route.min < 0n) {
        refuse('a route has malformed amounts');
      }
      if (route.path?.[route.path.length - 1]?.asset !== buyingSac) refuse(`a route does not end in ${limits.buying.getCode()}`);
      sold += route.amount;
      minOut += route.min;
    }
    assertRate(minOut, sold);

    if (op.auth?.length !== 1) refuse('expected exactly one authorisation entry');
    const entry = op.auth[0];
    if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') refuse('the authorisation is not address-bound');
    if (Address.fromScAddress(entry.credentials().address().address()).toString() !== limits.trader) {
      refuse('the authorisation is for another account');
    }
    const root = entry.rootInvocation();
    if (root.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') refuse('the authorisation is not a contract call');
    if (!root.function().contractFn().toXDR().equals(call.toXDR())) refuse('the authorisation covers a different call than the transaction');
    const subs = root.subInvocations();
    if (subs.length !== 1) refuse('the authorisation must cover exactly one token transfer');
    const sub = subs[0];
    if (sub.subInvocations().length) refuse('the authorised transfer has nested calls');
    if (sub.function().switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') refuse('the authorised sub-call is not a contract call');
    const transfer = sub.function().contractFn();
    if (contractOf(transfer) !== sellingSac || transfer.functionName().toString() !== 'transfer') {
      refuse(`the authorised sub-call is not a ${limits.selling.getCode()} transfer`);
    }
    const [from, to, amount] = nativeArgs(transfer);
    if (from !== limits.trader || to !== BROKER_ROUTER || amount !== sold) {
      refuse('the authorised transfer does not match the routed amount');
    }
    return sold;
  }

  const pendingSoroban = new Map<string, bigint>();

  function sorobanCallKey(tx: Transaction): string {
    return (tx.operations[0] as Operation.InvokeHostFunction).func.toXDR('base64');
  }

  function approveSoroban(tx: Transaction): void {
    const sold = checkSorobanSwap(tx);
    const key = sorobanCallKey(tx);
    if (pendingSoroban.has(key)) refuse('the same contract call is already awaiting signature');
    if (committedSell + sold > limits.maxSellStroops) {
      refuse(`would sell more than the ${fromStroops(limits.maxSellStroops)} ${limits.selling.getCode()} requested`);
    }
    committedSell += sold;
    pendingSoroban.set(key, sold);
  }

  function approveSorobanSigned(tx: Transaction): Transaction {
    const sold = checkSorobanSwap(tx);
    const key = sorobanCallKey(tx);
    if (pendingSoroban.get(key) !== sold) {
      refuse('the signed contract call differs from the approved one');
    }
    pendingSoroban.delete(key);
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
    approveSoroban,
    approveSorobanSigned,
    get committedSellStroops() {
      return committedSell;
    },
    get minBuyStroops() {
      return limits.minBuyStroops;
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

export async function authoriseBrokerInvocation(tx: Transaction, signer: Signer, networkPassphrase: string): Promise<Transaction> {
  const envelope = tx.toEnvelope();
  const entry = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp().auth()[0];
  const credentials = entry.credentials().address();
  credentials.signatureExpirationLedger((tx.ledgerBounds?.maxLedger ?? 0) + 1);
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: credentials.nonce(),
      invocation: entry.rootInvocation(),
      signatureExpirationLedger: credentials.signatureExpirationLedger(),
    }),
  );
  const signature = await signer.signHash(hash(preimage.toXDR()));
  credentials.signature(
    xdr.ScVal.scvVec([
      nativeToScVal(
        { public_key: StrKey.decodeEd25519PublicKey(signer.publicKey), signature },
        { type: { public_key: ['symbol', null], signature: ['symbol', null] } },
      ),
    ]),
  );
  return new Transaction(envelope, networkPassphrase);
}

type BrokerGuard = ReturnType<typeof createBrokerGuard>;

async function signSorobanRequest(
  tx: Transaction,
  networkFee: string,
  trader: string,
  signer: Signer,
  guard: BrokerGuard | undefined,
): Promise<string> {
  if (!guard) refuse('no trade is in progress');
  if (!tx.signatures.length) {
    guard.approveSoroban(tx);
    const authorised = guard.approveSorobanSigned(await authoriseBrokerInvocation(tx, signer, env.networkPassphrase));
    return (await signer.sign(authorised)).toXDR();
  }
  const bump = TransactionBuilder.buildFeeBumpTransaction(trader, networkFee, tx, env.networkPassphrase);
  return (await signer.sign(guard.approve(bump) as FeeBumpTransaction)).toXDR();
}

interface BrokerClientInternals {
  processMessage: (message: { data: string }) => void;
  status: string;
  send: (data: unknown) => void;
  notifyError: (e: unknown) => void;
}

function interceptBrokerTxRequests(
  client: StellarBrokerClient,
  trader: string,
  signer: Signer,
  currentGuard: () => BrokerGuard | undefined,
): void {
  const target = client as unknown as BrokerClientInternals;
  const original = target.processMessage.bind(client);
  target.processMessage = (message) => {
    let raw: { type?: string; hash?: string; xdr?: string; networkFee?: string };
    try {
      raw = JSON.parse(message.data);
    } catch {
      original(message);
      return;
    }
    if (raw.type !== 'tx' || !raw.xdr) {
      original(message);
      return;
    }
    logger.info({ brokerTx: { hash: raw.hash, xdr: raw.xdr, networkFee: raw.networkFee } }, 'stellarbroker tx request');
    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(raw.xdr, env.networkPassphrase);
    } catch {
      original(message);
      return;
    }
    if (!(tx instanceof Transaction) || !isSorobanTx(tx) || target.status !== 'trade') {
      original(message);
      return;
    }
    signSorobanRequest(tx, raw.networkFee ?? '0', trader, signer, currentGuard())
      .then((signed) => target.send({ type: 'tx', hash: raw.hash, xdr: signed }))
      .catch((e) => target.notifyError(e));
  };
}

export const BROKER_ACCOUNT_FUNDING_XLM = '2.5';

async function balanceView(address: string): Promise<HorizonBalanceView> {
  return (await horizon.loadAccount(address)) as unknown as HorizonBalanceView;
}

async function accountExists(address: string): Promise<boolean> {
  try {
    await horizon.loadAccount(address);
    return true;
  } catch {
    return false;
  }
}

async function pushTransfer(
  hashes: string[],
  signer: Signer,
  from: string,
  to: string,
  asset: Asset,
  stroops: bigint,
  context: string,
): Promise<void> {
  if (stroops <= 0n) return;
  const tx = new TransactionBuilder(await horizon.loadAccount(from), { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.payment({ destination: to, asset, amount: fromStroops(stroops) }))
    .setTimeout(120)
    .build();
  hashes.push((await submitToHorizon(await signer.sign(tx), context)).hash);
}

async function returnUnsold(
  hashes: string[],
  signer: Signer,
  trader: string,
  wallet: string,
  asset: Asset,
  baseline: bigint,
): Promise<void> {
  const left = spendableStroops(await balanceView(trader), asset) - baseline;
  await pushTransfer(hashes, signer, trader, wallet, asset, left, 'stellarbroker unsold return');
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

const CONFIRM_ATTEMPTS = 15;
const CONFIRM_INTERVAL_MS = 2_000;

async function confirmedOnChain(hashes: string[]): Promise<string[]> {
  const landed: string[] = [];
  for (const hash of hashes) {
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      try {
        const record = await horizon.transactions().transaction(hash).call();
        if (record.successful) landed.push(hash);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, CONFIRM_INTERVAL_MS));
      }
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
  asset_balance_changes?: {
    type?: string;
    to?: string;
    amount?: string;
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
  }[];
}

const isBuying = (buying: Asset, x: { asset_type?: string; asset_code?: string; asset_issuer?: string }) =>
  buying.isNative() ? x.asset_type === 'native' : x.asset_code === buying.getCode() && x.asset_issuer === buying.getIssuer();

export function sumDelivered(ops: DeliveredOperation[], trader: string, buying: Asset): bigint {
  let total = 0n;
  for (const op of ops) {
    if (op.transaction_successful === false) continue;
    if ((op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') && op.to === trader && isBuying(buying, op)) {
      total += toStroops(op.amount ?? '0');
    }
    if (op.type === 'invoke_host_function') {
      for (const change of op.asset_balance_changes ?? []) {
        if (change.type === 'transfer' && change.to === trader && isBuying(buying, change)) total += toStroops(change.amount ?? '0');
      }
    }
  }
  return total;
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

function applySlippage(stroops: bigint, slippageBps = env.routing.slippageBps): bigint {
  const bps = BigInt(slippageBps);
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
    const free = spendableStroops(await balanceView(wallet.address), selling.asset);
    if (free < sourceStroops) {
      throw routingError(
        `The swap wallet can spend ${fromStroops(free)} ${selling.ref.code}; it cannot sell ${fromStroops(sourceStroops)}`,
        422,
        'InsufficientBalance',
      );
    }
    const signer = await getManagedSigner(SWAP_SOURCE_USER);
    const trader = signer.publicKey;
    const separate = trader !== wallet.address;
    if (separate && !(await accountExists(trader))) {
      throw routingError(
        `The Stellar Broker trading account ${trader} does not exist yet. Its own key is the KMS key; send it ${BROKER_ACCOUNT_FUNDING_XLM} XLM once to create it.`,
        422,
        'BrokerAccountMissing',
      );
    }
    await ensureTrustline(trader, from);
    await ensureTrustline(trader, to);
    const inbound: string[] = [];
    const outbound: string[] = [];
    const baseline = separate ? spendableStroops(await balanceView(trader), selling.asset) : 0n;
    if (separate) {
      const xlmFree = spendableStroops(await balanceView(trader), Asset.native());
      await pushTransfer(inbound, signer, wallet.address, trader, Asset.native(), BROKER_MAX_FEE_STROOPS - xlmFree, 'stellarbroker fee buffer');
      await pushTransfer(inbound, signer, wallet.address, trader, selling.asset, sourceStroops, 'stellarbroker funding');
    }

    let guard: ReturnType<typeof createBrokerGuard> | undefined;
    const latestLedger = (await horizon.ledgers().order('desc').limit(1).call()).records[0].sequence;
    const client = new StellarBrokerClient({ partnerKey: env.routing.stellarBroker.partnerKey });
    interceptBrokerTxRequests(client, trader, signer, () => guard);
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
        trader,
        selling: selling.asset,
        buying: buying.asset,
        maxSellStroops: sourceStroops,
        minBuyStroops: applySlippage(estimated, env.routing.stellarBroker.maxSlippageBps),
        maxFeeStroops: BROKER_MAX_FEE_STROOPS,
        networkPassphrase: env.networkPassphrase,
        maxAuthLedger: latestLedger + BROKER_MAX_AUTH_LEDGERS,
      });
      guard = tradeGuard;
      const outcome = await runTrade(client, trader, async (payload) => signer.sign(tradeGuard.approve(payload)));
      const txHashes = await confirmedOnChain(tradeGuard.submittedHashes);
      if (outcome.status !== 'success' || !txHashes.length) {
        throw routingError(
          `StellarBroker trade ended "${outcome.status}" after selling ${outcome.sold} ${selling.ref.code}`,
          502,
          'RoutingUnavailable',
        );
      }
      const delivered = await deliveredOnChain(txHashes, trader, buying.asset);
      if (delivered < tradeGuard.minBuyStroops) {
        logger.error(
          { delivered: fromStroops(delivered), minimum: fromStroops(tradeGuard.minBuyStroops), txHashes },
          'stellarbroker delivered less than the quoted minimum',
        );
      }
      if (separate) {
        await pushTransfer(outbound, signer, trader, wallet.address, buying.asset, delivered, 'stellarbroker proceeds');
        await returnUnsold(outbound, signer, trader, wallet.address, selling.asset, baseline);
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
        minDestinationAmount: fromStroops(tradeGuard.minBuyStroops),
        destinationAmount: fromStroops(delivered),
        hops: quote.directTrade?.path?.length ?? 0,
        pools: [],
        txHash: txHashes[txHashes.length - 1],
        txHashes: [...inbound, ...txHashes, ...outbound],
        horizonUrl: horizonTxUrl(txHashes[txHashes.length - 1]),
      };
    } catch (e) {
      if (guard && guard.committedSellStroops > 0n) {
        logger.error({ err: e, committed: fromStroops(guard.committedSellStroops) }, 'stellarbroker trade failed after signing');
      }
      if (separate) {
        await confirmedOnChain(guard?.submittedHashes ?? []);
        await returnUnsold(outbound, signer, trader, wallet.address, selling.asset, baseline).catch((err) =>
          logger.error({ err, trader }, 'stellarbroker could not return unsold funds to the swap wallet'),
        );
      }
      throw e;
    } finally {
      client.close();
    }
  },
};
