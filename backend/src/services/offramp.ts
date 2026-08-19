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
import {
  carretMocks,
  createOfframpQuote,
  getConfiguredDepositAddress,
  getOfframpOrder,
  mapCarretStatus,
  placeOfframpOrder,
  resolveOfframpRouteId,
  type CarretOrder,
} from './carret.js';

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
  start(session: OffRampSession, ctx: OffRampContext): Promise<void>;
  status(session: OffRampSession): Promise<OffRampStatus>;
}

/**
 * Provider-private state we attach to a session but don't expose in the public
 * contract. Today: Carret's order_id (webhook `ref` + polling handle).
 */
interface CarretSessionMeta {
  carretOrderId?: string | number;
  carretQuoteId?: string | number;
  /** Stellar-style memo (numeric string) — required on every deposit tx. */
  carretDepositMemo?: string | null;
}
type SessionInternal = OffRampSession & CarretSessionMeta;

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
    s.carretQuoteId = quote.id;
    s.carretOrderId = order.id;
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
    // testnet side). Fail loud here rather than letting funds disappear.
    if (env.network === 'testnet') {
      throw httpError(
        'Carret off-ramp is mainnet-only (their dev uses real mainnet USDC). ' +
          'PathPulse is on STELLAR_NETWORK=testnet — refusing to place order. ' +
          'Switch STELLAR_NETWORK=mainnet, or set OFFRAMP_PROVIDER=ramp for testnet dev.',
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
    if (!env.carret.bankId) {
      throw httpError(
        'CARRET_BANK_ID not configured — register a bank first (POST /bank/) and set the env',
        500,
        'ConfigError',
      );
    }
    const order = await placeOfframpOrder({ quoteId: quote.id, bankId: env.carret.bankId });
    s.carretQuoteId = quote.id;
    s.carretOrderId = order.id;
    session.fiatAmountEstimate = quote.output_amount.amount.toFixed(2);
    session.merchantTransactionId = String(order.id);
    session.interactiveUrl = `${env.webAppUrl}/dashboard/offramp?session=${session.id}`;
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

// ── in-memory index (links off-ramp events to settlement batches; feeds D8) ──
const sessions = new Map<string, OffRampSession>();

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
  if (req.settlementBatchId) getSettlementBatch(req.settlementBatchId); // 404 if unknown

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
  };

  await provider.start(session, ctx);
  sessions.set(session.id, session);
  return session;
}

async function refresh(session: OffRampSession): Promise<OffRampSession> {
  if (session.status === 'completed' || session.status === 'error') return session;
  const next = await provider.status(session);
  if (next !== session.status) {
    session.status = next;
    session.updatedAt = new Date().toISOString();
  }
  return session;
}

export async function getWithdrawal(id: string): Promise<OffRampSession> {
  const s = sessions.get(id);
  if (!s) throw httpError(`Off-ramp session ${id} not found`, 404, 'NotFound');
  return refresh(s);
}

export async function listWithdrawals(cursor?: string, limit = 50): Promise<OffRampSessionPage> {
  const all = await Promise.all([...sessions.values()].map(refresh));
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : null;
  return { items, nextCursor: next };
}

/** Apply a verified Ramp webhook to the session identified by the `ref` query param. */
export function applyCallback(sessionId: string, rampStatus: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  // Terminal states are sticky — a late webhook can't regress completed → error.
  if (s.status === 'completed' || s.status === 'error') return true;
  const mapped = mapRampStatus(rampStatus);
  if (mapped && mapped !== s.status) {
    s.status = mapped;
    s.updatedAt = new Date().toISOString();
  }
  return true;
}

/**
 * Apply a verified Carret webhook. Carret webhooks carry the order_id (not our
 * session id), so we look up the session by the carretOrderId meta field.
 */
export function applyCarretCallback(orderId: string, carretStatus: string): boolean {
  const target = String(orderId);
  const s = [...sessions.values()].find(
    (v) => String((v as SessionInternal).carretOrderId ?? '') === target,
  );
  if (!s) return false;
  // Terminal states are sticky — a late webhook can't regress completed → error.
  if (s.status === 'completed' || s.status === 'error') return true;
  const mapped = mapCarretStatus(carretStatus);
  if (mapped && mapped !== s.status) {
    s.status = mapped;
    s.updatedAt = new Date().toISOString();
  }
  return true;
}

/** Expose the active provider name for the `/health` payload + routing decisions. */
export function activeProvider(): 'ramp' | 'carret' {
  return provider.name;
}
