import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type {
  AssetRef,
  CreateOffRampWithdrawalRequest,
  OffRampSession,
  OffRampSessionPage,
  OffRampStatus,
} from '@pathpulse/contract';
import { env, rampLive } from '../config/env.js';
import { getSettlementBatch } from '../stellar/settlement.js';
import { buildOfframpUrl, mapRampStatus } from './ramp.js';

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
  readonly sandbox: boolean;
  start(session: OffRampSession, ctx: OffRampContext): Promise<void>;
  status(session: OffRampSession): Promise<OffRampStatus>;
}

const callbackBase = `${process.env.PUBLIC_API_URL ?? `http://localhost:${env.port}`}/v1/offramp/callback`;

// A stable dev "anchor" account for the sandbox (where the user would send funds).
const sandboxAnchor = Keypair.random().publicKey();

const sandboxProvider: OffRampProvider = {
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

const liveProvider: OffRampProvider = {
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

const provider: OffRampProvider = rampLive ? liveProvider : sandboxProvider;

// ── in-memory index (links off-ramp events to settlement batches; feeds D8) ──
const sessions = new Map<string, OffRampSession>();

function assetOf(ref?: AssetRef): AssetRef {
  if (ref?.code) return ref;
  return { code: env.ramp.crypto };
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
    provider: 'ramp',
    sandbox: provider.sandbox,
    status: 'pending_user_transfer_start',
    interactiveUrl: '',
    amount: req.amount,
    asset: assetOf(req.asset),
    fiatCurrency: req.fiatCurrency ?? env.ramp.fiat,
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
  const mapped = mapRampStatus(rampStatus);
  if (mapped && mapped !== s.status) {
    s.status = mapped;
    s.updatedAt = new Date().toISOString();
  }
  return true;
}
