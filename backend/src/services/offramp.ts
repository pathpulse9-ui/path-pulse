import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type {
  AssetRef,
  CreateOffRampWithdrawalRequest,
  OffRampSession,
  OffRampSessionPage,
  OffRampStatus,
} from '@pathpulse/contract';
import { env, mercuryoLive } from '../config/env.js';
import { getSettlementBatch } from '../stellar/settlement.js';
import {
  signInOrSignUp,
  getSellRate,
  startSell,
  getTransactionStatus,
  mapMercuryoStatus,
} from './mercuryo.js';

/**
 * Fiat off-ramp orchestration (D4).
 *
 * Mercuryo is a **card-based** B2B REST ramp (not a Stellar SEP-24 anchor): the driver
 * sells crypto and Mercuryo pays fiat to their payment card. Flow: sign-in → sell-rates
 * → sell (hosted redirect) → user binds card + sends crypto to Mercuryo's deposit address
 * → Mercuryo pays fiat. Status via /b2b/transactions + callbacks.
 *
 * Behind an `OffRampProvider` interface. Live provider calls Mercuryo; sandbox stub
 * simulates the redirect + status progression so the flow is demoable until an
 * Sdk-Partner-Token + whitelisted IP land (external onboarding).
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
  /** Address to refund crypto to on error (defaults to the driver's own address). */
  refundAddress?: string;
}

interface OffRampProvider {
  readonly sandbox: boolean;
  start(session: OffRampSession, ctx: OffRampContext): Promise<void>;
  status(session: OffRampSession): Promise<OffRampStatus>;
}

// A stable dev "anchor" account for the sandbox (where the user would send funds).
const sandboxAnchor = Keypair.random().publicKey();

const sandboxProvider: OffRampProvider = {
  sandbox: true,
  async start(session) {
    session.fiatAmountEstimate = (Number(session.amount) * env.mercuryo.indicativeRate).toFixed(2);
    session.interactiveUrl = `${env.webAppUrl}/offramp?session=${session.id}`;
    session.anchorAccount = sandboxAnchor;
  },
  async status(session) {
    const elapsed = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
    if (elapsed < 8) return 'pending_user_transfer_start';
    if (elapsed < 16) return 'pending_anchor';
    return 'completed';
  },
};

// Per-session Mercuryo context needed to poll status (bearer + merchant id). Not persisted.
const mercuryoRefs = new Map<string, { bearer: string; merchantTransactionId: string }>();

const liveProvider: OffRampProvider = {
  sandbox: false,
  async start(session, ctx) {
    if (!ctx.email) {
      throw httpError('Off-ramp requires an authenticated user email (Mercuryo user)', 400, 'ValidationError');
    }
    const user = await signInOrSignUp(ctx.email, ctx.userIp);
    // NOTE: KYC (SumSub) must be `complete` for feature:crypto before a sell can settle;
    // the hosted redirect handles KYC when incomplete. See docs/API_ARCHITECTURE + Mercuryo guide.
    const rate = await getSellRate(user.bearerToken, session.asset.code, session.fiatCurrency, session.amount, env.mercuryo.network);
    session.fiatAmountEstimate = rate.fiatAmount;
    const merchantTransactionId = session.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 255);
    const refund = ctx.refundAddress ?? session.anchorAccount ?? '';
    const started = await startSell(user.bearerToken, rate.trxToken, refund, merchantTransactionId, ctx.userIp);
    session.interactiveUrl = started.redirectUrl;
    session.merchantTransactionId = started.merchantTransactionId;
    mercuryoRefs.set(session.id, { bearer: user.bearerToken, merchantTransactionId: started.merchantTransactionId });
  },
  async status(session) {
    const ref = mercuryoRefs.get(session.id);
    if (!ref) return session.status; // no live handle (e.g. after restart) — rely on callbacks
    const mapped = mapMercuryoStatus(await getTransactionStatus(ref.bearer, ref.merchantTransactionId));
    return mapped ?? session.status;
  },
};

const provider: OffRampProvider = mercuryoLive ? liveProvider : sandboxProvider;

// ── in-memory index (links off-ramp events to settlement batches; feeds D8) ──
const sessions = new Map<string, OffRampSession>();

function assetOf(ref?: AssetRef): AssetRef {
  if (ref?.code) return ref;
  return { code: env.mercuryo.crypto };
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
  const session: OffRampSession = {
    id: `ofr_${Date.now()}_${randomBytes(4).toString('hex')}`,
    provider: 'mercuryo',
    sandbox: provider.sandbox,
    status: 'pending_user_transfer_start',
    interactiveUrl: '',
    amount: req.amount,
    asset: assetOf(req.asset),
    fiatCurrency: req.fiatCurrency ?? env.mercuryo.fiat,
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

/** Apply a verified Mercuryo callback (webhook) to the matching session. */
export function applyCallback(merchantTransactionId: string, mercuryoStatus: string): boolean {
  const s = [...sessions.values()].find((x) => x.merchantTransactionId === merchantTransactionId);
  if (!s) return false;
  const mapped = mapMercuryoStatus(mercuryoStatus as never);
  if (mapped && mapped !== s.status) {
    s.status = mapped;
    s.updatedAt = new Date().toISOString();
  }
  return true;
}
