import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type {
  AssetRef,
  CreateOffRampWithdrawalRequest,
  OffRampSession,
  OffRampSessionPage,
  OffRampStatus,
} from '@pathpulse/contract';
import { env, rampLive, carretLive } from '../config/env.js';
import { getSettlementBatch } from '../stellar/settlement.js';
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
import { assertUnderLimit, recordUsage } from './carretLimits.js';
import {
  findSessionByCarretOrderId,
  getSession,
  listSessionsByUser,
  recordEvent,
  saveSession,
  type OffRampEventSource,
  type StoredOffRampSession,
} from './offRampStore.js';

/**
 * Fiat off-ramp orchestration (D4 — Ramp Network).
 *
 * Ramp is a widget-based ramp: the driver opens a signed off-ramp widget URL, Ramp runs
 * KYC + shows a deposit address + pays fiat to their bank. Status arrives via ECDSA-signed
 * V3 webhooks (see routes `/v1/offramp/callback`), correlated to the session by a `ref` param.
 *
 * Behind an `OffRampProvider` interface. Live provider builds the Ramp URL; sandbox stub
 * simulates the URL + status progression so the flow is demoable until a Ramp host API key
 * + webhook public key land (external onboarding).
 */

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export interface OffRampContext {
  email?: string;
  userIp?: string;
  /** The driver's Stellar address (the crypto being sold). */
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

// A stable dev "anchor" account for the sandbox (where the user would send funds).
const sandboxAnchor = Keypair.random().publicKey();

// ── Ramp providers (widget-based) ─────────────────────────────────────

const rampSandboxProvider: OffRampProvider = {
  name: 'ramp',
  sandbox: true,
  async start(session) {
    session.fiatAmountEstimate = (Number(session.amount) * env.ramp.indicativeRate).toFixed(2);
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;
    session.anchorAccount = sandboxAnchor;
  },
  async status(session) {
    // Time-based simulation so polling shows real progression.
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
  // Ramp status is webhook-driven (see applyCallback); polling just returns the last known state.
  async status(session) {
    return session.status;
  },
};

// ── Carret providers (server-driven REST) ─────────────────────────────

/**
 * Carret has no widget: the driver's flow is entirely backend-orchestrated.
 * The `interactiveUrl` we set is a page in our own web app that shows the
 * order status + Carret's crypto deposit address (fetched from the trading
 * wallet endpoint in a later pass — mocked here for now).
 */
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
    // Simulate the order lifecycle from Carret's status vocabulary.
    const carretStatus = carretMocks.advanceOrder(session.createdAt);
    return mapCarretStatus(carretStatus) ?? session.status;
  },
};

const carretLiveProvider: OffRampProvider = {
  name: 'carret',
  sandbox: false,
  async start(session) {
    const s = session as SessionInternal;
    // Refuse to run on Stellar testnet — Carret has no testnet, their dev env
    // uses REAL mainnet USDC + real INR banking. Sending testnet USDC to their
    // mainnet deposit address would silently vanish (no trustline on the
    // testnet side). Fail loud unless CARRET_ALLOW_TESTNET=true is set as an
    // explicit dev override (lets devs click the UI end-to-end without any
    // real crypto sends — every Carret API call still runs, but no on-chain
    // deposit is expected).
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
    // 1. Fetch Carret's deposit address for our corridor (must include memo);
    // 2. resolve route id; 3. lock a quote; 4. place order.
    const deposit = await getConfiguredDepositAddress();
    session.anchorAccount = deposit.address;
    s.carretDepositMemo = deposit.memo_label;

    const routeId = await resolveOfframpRouteId();
    const quote = await createOfframpQuote({ routeId, amount: session.amount });

    // PAT-80: refuse upfront if this order would push the driver's Carret
    // sub-account over the ₹30K/day withdraw_inr cap. The check runs after
    // the quote (so we know the exact INR amount) but before place_order
    // (so we don't waste a Carret order slot). If we don't have a
    // per-driver mapping yet (legacy or shared-account paths), skip the
    // pre-check — Carret's own 400 is the backstop.
    const fiatInr = Number(quote.output_amount.amount);
    const mapping = s.ppUserId ? await getMapping(s.ppUserId) : null;
    if (mapping) {
      await assertUnderLimit(mapping.carretAccountId, 'withdraw_inr', fiatInr);
    }

    // Prefer the driver's own registered + verified bank; fall back to
    // the env shared test bank when they haven't added one (dev/legacy).
    // Prod launch flips this so a missing driver bank blocks the order
    // instead of silently paying out to the platform's shared bank.
    let bankId: number | string | undefined = env.carret.bankId || undefined;
    if (mapping) {
      try {
        const banks = await listBanks(mapping.carretAccountId);
        const preferred =
          banks.find((b) => String(b.status).toLowerCase() === 'verified') ?? banks[0];
        if (preferred) bankId = preferred.id;
      } catch { /* Carret unreachable — env fallback stays */ }
    }
    if (!bankId) {
      throw httpError(
        'No verified bank on your Carret account. Register a bank first, then retry.',
        422,
        'NoBankRegistered',
      );
    }

    const order = await placeOfframpOrder({ quoteId: quote.id, bankId });
    s.carretQuoteId = String(quote.id);
    s.carretOrderId = String(order.id);
    session.fiatAmountEstimate = fiatInr.toFixed(2);
    session.merchantTransactionId = String(order.id);
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;

    // PAT-80: record the successful order against the daily bucket.
    if (mapping) {
      await recordUsage(mapping.carretAccountId, 'withdraw_inr', fiatInr);
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

// ── Provider selection ────────────────────────────────────────────────

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

export async function createWithdrawal(
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
  await getSettlementBatch(req.settlementBatchId);

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

/**
 * Persist a status transition and append the event. Terminal states are sticky:
 * `completed` and `error` never move again, so a late webhook or a reconciler
 * pass cannot regress a settled session.
 */
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
  return session;
}

async function refresh(session: SessionInternal): Promise<SessionInternal> {
  if (session.status === 'completed' || session.status === 'error') return session;
  const next = await provider.status(session);
  return applyStatus(session, next, 'poll');
}

/**
 * Sessions are per-driver: a caller may only read their own. An id owned by
 * someone else is reported as 404 rather than 403 so the endpoint doesn't
 * confirm that the id exists.
 */
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
  const owned = await listSessionsByUser(userId);
  const all = await Promise.all(owned.map(refresh));
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : null;
  return { items, nextCursor: next };
}

/** Apply a verified Ramp webhook to the session identified by the `ref` query param. */
export async function applyCallback(sessionId: string, rampStatus: string): Promise<boolean> {
  const s = await getSession(sessionId);
  if (!s) return false;
  const mapped = mapRampStatus(rampStatus);
  if (mapped) await applyStatus(s, mapped, 'webhook', { rampStatus });
  return true;
}

/**
 * Apply a verified Carret webhook. Carret webhooks carry the order_id (not our
 * session id), so we look up the session by the persisted carretOrderId.
 */
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

/**
 * Drive a session to a status discovered out of band — used by the orphan
 * reconciler when a webhook never arrived and Carret's order list is the only
 * source of truth for where the order actually ended up.
 */
export async function reconcileSessionStatus(
  sessionId: string,
  next: OffRampStatus,
  detail: Record<string, unknown>,
): Promise<OffRampSession | null> {
  const s = await getSession(sessionId);
  if (!s) return null;
  return applyStatus(s, next, 'reconciler', detail);
}

/** Attach the Carret order the reconciler matched to an orphaned session. */
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

/**
 * Price a withdrawal without committing anything. Carret quotes are read-only —
 * no order, no funds — so this stays available on testnet even though placing an
 * order does not.
 */
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

/** Expose the active provider name for the `/health` payload + routing decisions. */
export function activeProvider(): 'ramp' | 'carret' {
  return provider.name;
}
