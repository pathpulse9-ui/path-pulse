import { randomBytes } from 'node:crypto';
import { Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { horizon, submitToHorizon } from '../stellar/network.js';
import { getManagedSigner, getManagedWallet } from '../stellar/managed.js';
import { logger } from '../config/logger.js';
import type {
  AssetRef,
  CreateOffRampWithdrawalRequest,
  OffRampSession,
  OffRampSessionPage,
  OffRampStatus,
} from '@pathpulse/contract';
import { env, rampLive, carretLive } from '../config/env.js';
import { getSettlementBatch, toStroops, fromStroops } from '../stellar/settlement.js';
import { buildOfframpUrl, mapRampStatus } from './ramp.js';
import type { OffRampQuote } from '@pathpulse/contract';

interface CarretQuoteShape {
  id?: number | string;
  asset?: string;
  fiat?: string;
  base_rate?: number;
  rate_info?: { rate?: number };
  output_amount?: { amount?: number };
  gross_output_amount?: { amount?: number };
  fee_details?: { carret_fee_amount?: number; tax_amount?: number };
}

import {
  carretMocks,
  createOfframpQuote,
  getConfiguredDepositAddress,
  getOfframpOrder,
  listBanks,
  mapCarretStatus,
  placeOfframpOrder,
  resolveOfframpRouteId,
  type CarretOrder,
} from './carret.js';
import { getMapping } from './carretSubAccountStore.js';
import { reserveUsage, releaseUsage } from './carretLimits.js';
import { decodeKeyset, encodeKeyset } from '../db/keyset.js';
import { notifyUserInBackground } from './push.js';
import {
  findSessionByCarretOrderId,
  getSession,
  listSessionsByUser,
  recordEvent,
  saveSession,
  type OffRampEventSource,
  type StoredOffRampSession,
} from './offRampStore.js';


function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export async function broadcastCarretDeposit(params: {
  userId: string;
  destination: string;
  memo?: string;
  amount: string;
}): Promise<string> {
  const wallet = await getManagedWallet(params.userId);
  if (!wallet) {
    throw httpError(`Managed wallet not provisioned for user ${params.userId}`, 500, 'ConfigError');
  }
  const signer = await getManagedSigner(params.userId);
  const issuer = process.env.CARRET_USDC_ISSUER ?? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const asset = new Asset('USDC', issuer);

  const source = await horizon.loadAccount(wallet.address);
  const builder = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  }).addOperation(Operation.payment({
    destination: params.destination,
    asset,
    amount: params.amount,
  }));
  if (params.memo) {
    const digitsOnly = /^\d{1,20}$/.test(params.memo);
    builder.addMemo(
      digitsOnly ? Memo.id(params.memo) : Memo.text(params.memo),
    );
  }

  let tx = builder.setTimeout(180).build();
  tx = (await signer.sign(tx)) as typeof tx;
  const res = await submitToHorizon(tx, 'carret deposit payment');
  return res.hash;
}

export interface OffRampContext {
  email?: string;
  userIp?: string;
  userAddress?: string;
}

interface OffRampProvider {
  readonly name: 'ramp' | 'carret';
  readonly sandbox: boolean;
  start(session: SessionInternal, ctx: OffRampContext): Promise<void>;
  status(session: SessionInternal): Promise<OffRampStatus>;
}

type SessionInternal = StoredOffRampSession;

const callbackBase = `${process.env.PUBLIC_API_URL ?? `http://localhost:${env.port}`}/v1/offramp/callback`;

const sandboxAnchor = Keypair.random().publicKey();


const rampSandboxProvider: OffRampProvider = {
  name: 'ramp',
  sandbox: true,
  async start(session) {
    session.fiatAmountEstimate = (Number(session.amount) * env.ramp.indicativeRate).toFixed(2);
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;
    session.anchorAccount = sandboxAnchor;
  },
  async status(session) {
    const elapsed = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
    if (elapsed < 8) return 'pending_user_transfer_start';
    if (elapsed < 16) return 'pending_anchor';
    return 'completed';
  },
};

const rampLiveProvider: OffRampProvider = {
  name: 'ramp',
  sandbox: false,
  async start(session, ctx) {
    session.fiatAmountEstimate = (Number(session.amount) * env.ramp.indicativeRate).toFixed(2);
    session.interactiveUrl = buildOfframpUrl({
      sessionId: session.id,
      amount: session.amount,
      userAddress: ctx.userAddress,
      callbackBase,
      finalUrl: `${env.webAppUrl}/dashboard/offramp?session=${session.id}`,
    });
  },
  async status(session) {
    return session.status;
  },
};


const carretSandboxProvider: OffRampProvider = {
  name: 'carret',
  sandbox: true,
  async start(session) {
    const s = session as SessionInternal;
    const quote = carretMocks.quote(session.amount);
    const order = carretMocks.order(quote.id, session.amount);
    s.carretQuoteId = String(quote.id);
    s.carretOrderId = String(order.id);
    session.fiatAmountEstimate = quote.output_amount.amount.toFixed(2);
    session.anchorAccount = sandboxAnchor;
    session.merchantTransactionId = String(order.id); // reuse existing field for correlation
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;
  },
  async status(session) {
    const s = session as SessionInternal;
    if (!s.carretOrderId) return session.status;
    const carretStatus = carretMocks.advanceOrder(session.createdAt);
    return mapCarretStatus(carretStatus) ?? session.status;
  },
};

const carretLiveProvider: OffRampProvider = {
  name: 'carret',
  sandbox: false,
  async start(session) {
    const s = session as SessionInternal;
    if (env.network === 'testnet' && !env.carret.allowTestnet) {
      throw httpError(
        'Carret off-ramp is mainnet-only (their dev uses real mainnet USDC). ' +
          'PathPulse is on STELLAR_NETWORK=testnet — refusing to place order. ' +
          'For dev clicking: set CARRET_ALLOW_TESTNET=true. ' +
          'Otherwise: STELLAR_NETWORK=mainnet, or OFFRAMP_PROVIDER=ramp.',
        500,
        'ConfigError',
      );
    }
    const deposit = await getConfiguredDepositAddress();
    session.anchorAccount = deposit.address;
    s.carretDepositMemo = deposit.memo_label;

    const mapping = s.ppUserId ? await getMapping(s.ppUserId) : null;
    const accountId: number | string | undefined = mapping?.carretAccountId ?? env.carret.accountId;

    const routeId = await resolveOfframpRouteId();
    const quote = await createOfframpQuote({ routeId, amount: session.amount, accountId });

    const fiatInr = Number(quote.output_amount.amount);
    if (mapping) {
      await reserveUsage(mapping.carretAccountId, 'withdraw_inr', fiatInr);
    }

    let orderPlaced = false;
    try {
      let bankId: number | string | undefined = env.carret.bankId || undefined;
      if (mapping) {
        try {
          const banks = await listBanks(mapping.carretAccountId);
          const preferred =
            banks.find((b) => String(b.status).toLowerCase() === 'verified') ?? banks[0];
          if (preferred) bankId = preferred.id;
        } catch { }
      }
      if (!bankId) {
        throw httpError(
          'No verified bank on your Carret account. Register a bank first, then retry.',
          422,
          'NoBankRegistered',
        );
      }

      const order = await placeOfframpOrder({ quoteId: quote.id, bankId, accountId });
      orderPlaced = true;
      s.carretQuoteId = String(quote.id);
      s.carretOrderId = String(order.id);
      session.fiatAmountEstimate = fiatInr.toFixed(2);
      session.merchantTransactionId = String(order.id);
      session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;

      if (env.network === 'mainnet' && s.ppUserId) {
        try {
          const txHash = await broadcastCarretDeposit({
            userId: s.ppUserId,
            destination: deposit.address,
            memo: deposit.memo_label ?? undefined,
            amount: session.amount,
          });
          s.stellarTxHash = txHash;
          s.network = 'mainnet';
        } catch (e) {
          logger?.warn?.({ err: e, sessionId: session.id }, 'carret deposit broadcast failed');
        }
      }
    } catch (e) {
      if (mapping && !orderPlaced) await releaseUsage(mapping.carretAccountId, 'withdraw_inr', fiatInr);
      throw e;
    }
  },
  async status(session) {
    const s = session as SessionInternal;
    if (!s.carretOrderId) return session.status;
    let order: CarretOrder;
    try {
      order = await getOfframpOrder(s.carretOrderId);
    } catch {
      return session.status; // transient — keep last known
    }
    return mapCarretStatus(order.status) ?? session.status;
  },
};


function pickProvider(): OffRampProvider {
  if (env.offrampProvider === 'carret') {
    return carretLive ? carretLiveProvider : carretSandboxProvider;
  }
  return rampLive ? rampLiveProvider : rampSandboxProvider;
}

const provider: OffRampProvider = pickProvider();


function assetOf(ref?: AssetRef): AssetRef {
  if (ref?.code) return ref;
  const code = provider.name === 'carret' ? env.carret.crypto : env.ramp.crypto;
  return { code };
}

export function checkWithdrawalEntitlement(
  userId: string,
  settlementBatchId: string,
  amount: string,
  payouts: Array<{ userId: string; amount: string }>,
  priorSessions: Array<{ settlementBatchId?: string; status: string; amount: string }>,
): void {
  const paid = payouts.filter((p) => p.userId === userId).reduce((sum, p) => sum + toStroops(p.amount), 0n);
  if (paid === 0n) {
    throw httpError(`Settlement batch ${settlementBatchId} paid nothing to this account`, 403, 'NotEntitled');
  }
  const already = priorSessions
    .filter((s) => s.settlementBatchId === settlementBatchId && s.status !== 'error')
    .reduce((sum, s) => sum + toStroops(s.amount), 0n);
  if (already + toStroops(amount) > paid) {
    throw httpError(
      `Withdrawal exceeds this account's ${fromStroops(paid)} payout from batch ${settlementBatchId} (${fromStroops(already)} already withdrawn)`,
      422,
      'ExceedsEntitlement',
    );
  }
}

async function assertWithdrawalEntitlement(userId: string, settlementBatchId: string, amount: string): Promise<void> {
  const batch = await getSettlementBatch(settlementBatchId);
  checkWithdrawalEntitlement(userId, settlementBatchId, amount, batch.driverPayouts ?? [], await listSessionsByUser(userId));
}

const withdrawalLocks = new Map<string, Promise<unknown>>();

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = withdrawalLocks.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  withdrawalLocks.set(userId, tail);
  void tail.then(() => {
    if (withdrawalLocks.get(userId) === tail) withdrawalLocks.delete(userId);
  });
  return run;
}

export function createWithdrawal(
  userId: string,
  req: CreateOffRampWithdrawalRequest,
  ctx: OffRampContext = {},
): Promise<OffRampSession> {
  return withUserLock(userId, () => createWithdrawalUnlocked(userId, req, ctx));
}

async function createWithdrawalUnlocked(
  userId: string,
  req: CreateOffRampWithdrawalRequest,
  ctx: OffRampContext = {},
): Promise<OffRampSession> {
  if (!/^\d+(\.\d{1,7})?$/.test(req.amount) || Number(req.amount) <= 0) {
    throw httpError('amount must be a positive 7-decimal number', 400, 'ValidationError');
  }
  if (!req.settlementBatchId) {
    throw httpError(
      'settlementBatchId is required — every off-ramp session must name the settlement batch it draws from',
      400,
      'ValidationError',
    );
  }
  await assertWithdrawalEntitlement(userId, req.settlementBatchId, req.amount);

  const now = new Date().toISOString();
  const fiatFallback = provider.name === 'carret' ? env.carret.fiat : env.ramp.fiat;
  const session: SessionInternal = {
    id: `ofr_${Date.now()}_${randomBytes(4).toString('hex')}`,
    provider: provider.name,
    sandbox: provider.sandbox,
    status: 'pending_user_transfer_start',
    interactiveUrl: '',
    amount: req.amount,
    asset: assetOf(req.asset),
    fiatCurrency: req.fiatCurrency ?? fiatFallback,
    settlementBatchId: req.settlementBatchId,
    createdAt: now,
    updatedAt: now,
    ppUserId: userId,
  };

  await provider.start(session, ctx);
  await saveSession(session);
  await recordEvent({
    sessionId: session.id,
    previousStatus: null,
    status: session.status,
    source: 'create',
    detail: {
      provider: session.provider,
      settlementBatchId: session.settlementBatchId,
      carretOrderId: session.carretOrderId ?? null,
    },
    createdAt: now,
  });
  return session;
}

async function applyStatus(
  session: SessionInternal,
  next: OffRampStatus,
  source: OffRampEventSource,
  detail?: Record<string, unknown>,
): Promise<SessionInternal> {
  if (session.status === 'completed' || session.status === 'error') return session;
  if (next === session.status) return session;

  const previousStatus = session.status;
  session.status = next;
  session.updatedAt = new Date().toISOString();
  await saveSession(session);
  await recordEvent({
    sessionId: session.id,
    previousStatus,
    status: next,
    source,
    detail,
    createdAt: session.updatedAt,
  });
  if (next === 'completed') {
    notifyUserInBackground(session.ppUserId, {
      title: 'Withdrawal paid',
      body: `${session.amount} ${session.asset.code} → ${session.fiatCurrency} has been paid to your bank.`,
      data: { kind: 'offramp_completed', sessionId: session.id },
    });
  } else if (next === 'error') {
    notifyUserInBackground(session.ppUserId, {
      title: "Withdrawal didn't complete",
      body: 'Your withdrawal was cancelled. Any blocked funds are released back to your account.',
      data: { kind: 'offramp_error', sessionId: session.id },
    });
  }
  return session;
}

async function refresh(session: SessionInternal): Promise<SessionInternal> {
  if (session.status === 'completed' || session.status === 'error') return session;
  const next = await provider.status(session);
  return applyStatus(session, next, 'poll');
}

export async function getWithdrawal(id: string, userId: string): Promise<OffRampSession> {
  const s = await getSession(id);
  if (!s || s.ppUserId !== userId) {
    throw httpError(`Off-ramp session ${id} not found`, 404, 'NotFound');
  }
  return refresh(s);
}

export async function listWithdrawals(
  userId: string,
  cursor?: string,
  limit = 50,
): Promise<OffRampSessionPage> {
  const key = decodeKeyset(cursor);
  const size = Number.isInteger(limit) ? Math.min(Math.max(1, limit), 100) : 50;
  const ordered = (await listSessionsByUser(userId)).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const iso = (s: { createdAt: string }) => new Date(s.createdAt).toISOString();
  const after = key
    ? ordered.filter((s) => iso(s) < key.createdAt || (iso(s) === key.createdAt && s.id < key.id))
    : ordered;
  const page = after.slice(0, size);
  const items = await Promise.all(page.map(refresh));
  const last = page[page.length - 1];
  return { items, nextCursor: after.length > size && last ? encodeKeyset(last.createdAt, last.id) : null };
}

export async function applyCallback(sessionId: string, rampStatus: string): Promise<boolean> {
  const s = await getSession(sessionId);
  if (!s) return false;
  const mapped = mapRampStatus(rampStatus);
  if (mapped) await applyStatus(s, mapped, 'webhook', { rampStatus });
  return true;
}

export async function applyCarretCallback(
  orderId: string,
  carretStatus: string,
): Promise<boolean> {
  const s = await findSessionByCarretOrderId(String(orderId));
  if (!s) return false;
  const mapped = mapCarretStatus(carretStatus);
  if (mapped) await applyStatus(s, mapped, 'webhook', { carretStatus, orderId: String(orderId) });
  return true;
}

export async function reconcileSessionStatus(
  sessionId: string,
  next: OffRampStatus,
  detail: Record<string, unknown>,
): Promise<OffRampSession | null> {
  const s = await getSession(sessionId);
  if (!s) return null;
  return applyStatus(s, next, 'reconciler', detail);
}

export async function attachCarretOrder(
  sessionId: string,
  orderId: string,
): Promise<void> {
  const s = await getSession(sessionId);
  if (!s) return;
  s.carretOrderId = String(orderId);
  s.merchantTransactionId = String(orderId);
  s.updatedAt = new Date().toISOString();
  await saveSession(s);
}

export async function quoteWithdrawal(amount: string): Promise<OffRampQuote> {
  if (activeProvider() === 'carret' && carretLive) {
    const routeId = await resolveOfframpRouteId();
    const q = (await createOfframpQuote({ routeId, amount })) as CarretQuoteShape;
    const fees: OffRampQuote['fees'] = [];
    if (q.fee_details?.carret_fee_amount !== undefined) {
      fees.push({ label: 'Carret fee', amount: String(q.fee_details.carret_fee_amount) });
    }
    if (q.fee_details?.tax_amount !== undefined) {
      fees.push({ label: 'Tax', amount: String(q.fee_details.tax_amount) });
    }
    return {
      provider: 'carret',
      live: true,
      quoteId: q.id === undefined ? undefined : String(q.id),
      asset: q.asset ?? env.carret.crypto,
      fiatCurrency: q.fiat ?? env.carret.fiat,
      amount,
      grossFiatAmount: String(q.gross_output_amount?.amount ?? ''),
      fiatAmount: String(q.output_amount?.amount ?? ''),
      rate: String(q.rate_info?.rate ?? q.base_rate ?? ''),
      fees,
    };
  }

  const rate = env.ramp.indicativeRate;
  const gross = Number(amount) * rate;
  return {
    provider: activeProvider(),
    live: false,
    asset: env.ramp.crypto,
    fiatCurrency: env.ramp.fiat,
    amount,
    grossFiatAmount: gross.toFixed(2),
    fiatAmount: gross.toFixed(2),
    rate: String(rate),
    fees: [],
  };
}

export function activeProvider(): 'ramp' | 'carret' {
  return provider.name;
}
