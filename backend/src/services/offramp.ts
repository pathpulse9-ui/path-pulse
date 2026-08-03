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

/**
 * Fiat off-ramp orchestration (D4 — Mercuryo SEP-24).
 *
 * The withdrawal flow is: driver requests a withdrawal → backend opens a SEP-24
 * interactive session with the anchor (Mercuryo) → client opens the hosted webview
 * (KYC + bank details + conversion) → user sends the stablecoin to the anchor →
 * anchor pays out fiat. Mercuryo owns KYC/compliance/custody.
 *
 * Behind an `OffRampProvider` interface so the real Mercuryo integration drops in
 * without touching callers. Until credentials land (external onboarding), a sandbox
 * stub simulates the interactive URL + status progression so the withdraw flow is
 * demoable end-to-end. Off-ramp sessions are indexed and can link to a settlement batch.
 */

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

interface StartResult {
  interactiveUrl: string;
  anchorAccount: string;
  fiatAmountEstimate: string;
}

interface OffRampProvider {
  readonly sandbox: boolean;
  start(session: OffRampSession): Promise<StartResult>;
  /** Resolve current status (live providers poll the anchor; the stub simulates). */
  status(session: OffRampSession): OffRampStatus;
}

// A stable dev "anchor" account for the sandbox (where the user would send funds).
const sandboxAnchor = Keypair.random().publicKey();

const sandboxProvider: OffRampProvider = {
  sandbox: true,
  async start(session) {
    const estimate = (Number(session.amount) * env.mercuryo.indicativeRate).toFixed(2);
    return {
      // Sandbox: deep-link back into the ops console; a real anchor returns its hosted widget URL.
      interactiveUrl: `${env.webAppUrl}/offramp?session=${session.id}`,
      anchorAccount: sandboxAnchor,
      fiatAmountEstimate: estimate,
    };
  },
  status(session) {
    // Time-based simulation so polling shows real progression.
    const elapsed = (Date.now() - new Date(session.createdAt).getTime()) / 1000;
    if (elapsed < 8) return 'pending_user_transfer_start';
    if (elapsed < 16) return 'pending_anchor';
    return 'completed';
  },
};

const liveProvider: OffRampProvider = {
  sandbox: false,
  async start() {
    // TODO(mercuryo): SEP-10 auth with the anchor, then POST
    // {MERCURYO_SEP24_URL}/transactions/withdraw/interactive with the JWT, asset, amount;
    // sign the returned widget URL with MERCURYO_WIDGET_ID/SECRET.
    throw httpError(
      'Live Mercuryo off-ramp not yet wired — set MERCURYO_SEP24_URL / MERCURYO_WIDGET_ID / MERCURYO_SECRET',
      501,
      'ExternalDependencyUnavailable',
    );
  },
  status() {
    throw httpError('Live Mercuryo status polling not yet wired', 501, 'ExternalDependencyUnavailable');
  },
};

const provider: OffRampProvider = mercuryoLive ? liveProvider : sandboxProvider;

// ── in-memory index (links off-ramp events to settlement batches; feeds D8) ──
const sessions = new Map<string, OffRampSession>();

function assetOf(ref?: AssetRef): AssetRef {
  if (ref?.code) return ref;
  const { code, issuer } = env.mercuryo.defaultAsset;
  return issuer ? { code, issuer } : { code };
}

export async function createWithdrawal(
  userId: string,
  req: CreateOffRampWithdrawalRequest,
): Promise<OffRampSession> {
  if (!/^\d+(\.\d{1,7})?$/.test(req.amount) || Number(req.amount) <= 0) {
    throw httpError('amount must be a positive 7-decimal number', 400, 'ValidationError');
  }
  // Link to a settlement batch if provided — must exist (throws 404 otherwise).
  if (req.settlementBatchId) getSettlementBatch(req.settlementBatchId);

  const now = new Date().toISOString();
  const session: OffRampSession = {
    id: `ofr_${Date.now()}_${randomBytes(4).toString('hex')}`,
    provider: 'mercuryo',
    sandbox: provider.sandbox,
    status: 'pending_user_transfer_start',
    interactiveUrl: '',
    amount: req.amount,
    asset: assetOf(req.asset),
    fiatCurrency: req.fiatCurrency ?? env.mercuryo.defaultFiat,
    settlementBatchId: req.settlementBatchId,
    createdAt: now,
    updatedAt: now,
  };

  const started = await provider.start(session);
  session.interactiveUrl = started.interactiveUrl;
  session.anchorAccount = started.anchorAccount;
  session.fiatAmountEstimate = started.fiatAmountEstimate;

  sessions.set(session.id, session);
  return session;
}

function refresh(session: OffRampSession): OffRampSession {
  const next = provider.status(session);
  if (next !== session.status) {
    session.status = next;
    session.updatedAt = new Date().toISOString();
  }
  return session;
}

export function getWithdrawal(id: string): OffRampSession {
  const s = sessions.get(id);
  if (!s) throw httpError(`Off-ramp session ${id} not found`, 404, 'NotFound');
  return refresh(s);
}

export function listWithdrawals(cursor?: string, limit = 50): OffRampSessionPage {
  const all = [...sessions.values()].map(refresh).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = cursor ? Math.max(0, parseInt(cursor, 10) || 0) : 0;
  const size = Math.min(Math.max(1, limit), 100);
  const items = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : null;
  return { items, nextCursor: next };
}
