import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
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
  createCryptoDeposit,
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
import { sendAlertInBackground } from './alerts.js';
import { sendCarretDeposit } from './carretDeposit.js';
import { logUpstream } from '../util/upstreamLog.js';
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

export async function registerCarretDeposit(
  s: SessionInternal,
  accountId: string,
  deposit: { id: number; asset: string; chain: string },
): Promise<boolean> {
  if (!s.stellarTxHash) return false;
  try {
    await createCryptoDeposit({
      accountId,
      carretWalletId: deposit.id,
      asset: deposit.asset,
      chain: deposit.chain,
      amount: s.amount,
      txnId: s.stellarTxHash,
    });
    return true;
  } catch (e) {
    logUpstream('carret deposit registration failed', e);
    sendAlertInBackground({
      key: `offramp:register:${s.id}`,
      severity: 'critical',
      title: 'Off-ramp deposit sent but not registered with Carret',
      detail: `Session ${s.id}: tx ${s.stellarTxHash} reached Carret's address but /crypto_deposit/ failed. Retry with POST /v1/ops/offramp/sessions/${s.id}/register-deposit.`,
    });
    return false;
  }
}

export async function retryDepositRegistration(sessionId: string): Promise<{ registered: boolean; txHash: string }> {
  const s = await getSession(sessionId);
  if (!s) throw httpError(`Off-ramp session ${sessionId} not found`, 404, 'NotFound');
  if (s.provider !== 'carret' || !s.stellarTxHash) {
    throw httpError(`Session ${sessionId} has no backend-broadcast Carret deposit to register`, 422, 'NoDeposit');
  }
  const mapping = await getMapping(s.ppUserId);
  if (!mapping) throw httpError(`Session ${sessionId} owner has no Carret account`, 422, 'NoMapping');
  const deposit = await getConfiguredDepositAddress();
  return { registered: await registerCarretDeposit(s, mapping.carretAccountId, deposit), txHash: s.stellarTxHash };
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
    const mapping = s.ppUserId ? await getMapping(s.ppUserId) : null;
    if (!mapping) {
      throw httpError(
        'Withdrawals need your own Carret account — complete Carret sign-up and KYC first',
        422,
        'NoMapping',
      );
    }
    const accountId = mapping.carretAccountId;

    const deposit = await getConfiguredDepositAddress();
    session.anchorAccount = deposit.address;
    s.carretDepositMemo = deposit.memo_label;

    const routeId = await resolveOfframpRouteId();
    const quote = await createOfframpQuote({ routeId, amount: session.amount, accountId });

    const fiatInr = Number(quote.output_amount.amount);
    await reserveUsage(accountId, 'withdraw_inr', fiatInr);

    let order: CarretOrder;
    try {
      const banks = await listBanks(accountId);
      const preferred = banks.find((b) => String(b.status).toLowerCase() === 'verified');
      if (!preferred) {
        throw httpError(
          'No verified bank on your Carret account. Register a bank first, then retry.',
          422,
          'NoBankRegistered',
        );
      }
      order = await placeOfframpOrder({ quoteId: quote.id, bankId: preferred.id, accountId });
    } catch (e) {
      await releaseUsage(accountId, 'withdraw_inr', fiatInr);
      throw e;
    }
    s.carretQuoteId = String(quote.id);
    s.carretOrderId = String(order.id);
    session.fiatAmountEstimate = fiatInr.toFixed(2);
    session.merchantTransactionId = String(order.id);
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;

    if (env.network !== 'mainnet' || !s.ppUserId) return;

    let txHash: string;
    try {
      txHash = await sendCarretDeposit(s.ppUserId, deposit.address, deposit.memo_label, session.amount);
    } catch (e) {
      logger.error({ err: e, sessionId: session.id, carretOrderId: s.carretOrderId }, 'carret deposit broadcast failed');
      await releaseUsage(accountId, 'withdraw_inr', fiatInr);
      session.status = 'error';
      sendAlertInBackground({
        key: `offramp:broadcast:${session.id}`,
        severity: 'critical',
        title: 'Off-ramp deposit was not sent — cancel the Carret order',
        detail: `Session ${session.id}: the USDC deposit failed, so Carret order ${s.carretOrderId} on account ${accountId} will never fill. Cancel it in the Carret dashboard.`,
      });
      return;
    }
    s.stellarTxHash = txHash;
    s.network = 'mainnet';
    await registerCarretDeposit(s, accountId, deposit);
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
  if (batch.status && batch.status !== 'confirmed') {
    throw httpError(`Settlement batch ${settlementBatchId} is ${batch.status}, not confirmed on-chain`, 409, 'SettlementNotConfirmed');
  }
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
  // Strict network match before entitlement. Caught by a T2 reviewer on
  // 2026-10-25: a mainnet off-ramp session referenced a leftover testnet
  // settlement_batch_id because we only validated the id existed. Letting a
  // cross-network reference through breaks the audit chain (mainnet payout →
  // mainnet batch → mainnet off-ramp) reviewers rely on. Entitlement check
  // runs after so we fail with the clearer NetworkMismatch error first.
  const batch = await getSettlementBatch(req.settlementBatchId);
  if (batch.network && batch.network !== env.network) {
    throw httpError(
      `settlement_batch_id ${req.settlementBatchId} is on ${batch.network}, ` +
        `but STELLAR_NETWORK=${env.network}. Use a batch from the same network.`,
      422,
      'NetworkMismatch',
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
  if (!s || s.provider !== 'carret') return false;
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
  if (!s || s.provider !== 'carret') return null;
  return applyStatus(s, next, 'reconciler', detail);
}

export async function attachCarretOrder(
  sessionId: string,
  orderId: string,
): Promise<void> {
  const s = await getSession(sessionId);
  if (!s || s.provider !== 'carret') return;
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
