import { randomBytes } from 'node:crypto';
import { carretLive, env } from '../config/env.js';
import {
  carretMocks,
  createOnrampQuote,
  getOnrampOrder,
  listBanks,
  mapCarretStatus,
  placeOnrampOrder,
  resolveOnrampRouteId,
  type CarretOrder,
} from './carret.js';
import { getMapping } from './carretSubAccountStore.js';
import { evictOldest } from '../util/bounded.js';

/**
 * On-ramp (INR → crypto) orchestration.
 *
 * Symmetric with off-ramp, minus the Stellar deposit step: the driver's
 * INR is debited from their verified bank via Carret, and the resulting
 * crypto lands on their Carret trading wallet — nothing on our chain
 * side to sign for. Session state lives in an in-memory Map keyed by
 * userId, same pattern as `offramp.ts` uses for its sandbox path.
 *
 * Statuses we surface to the client mirror the Carret order lifecycle
 * (`open → filled | partially_filled | cancelled | partially_cancelled`)
 * remapped through the same helper the off-ramp side uses.
 */

export interface OnRampQuote {
  amount: string;         // INR (input)
  cryptoAmount: string;   // USDC (indicative output)
  rate: string;
  asset: string;
  fiat: string;
  provider: 'carret';
  live: boolean;
  fees: { label: string; amount: string; currency: string }[];
  expiresAt?: string;
}

export interface OnRampSession {
  id: string;
  userId: string;
  amount: string;         // INR
  cryptoAmount?: string;  // filled from Carret
  asset: string;          // USDC
  fiat: string;           // INR
  status: string;         // Carret status raw
  provider: 'carret';
  createdAt: string;
  bankLast4?: string;
  carretOrderId?: string | number;
  carretQuoteId?: string | number;
}

export interface OnRampSessionPage {
  items: OnRampSession[];
  nextCursor?: string;
}

const sessions = new Map<string, OnRampSession>();

/** Indicative + live quote in one shot. Mirrors the off-ramp quote endpoint. */
export async function getQuote(amount: string): Promise<OnRampQuote> {
  const inr = Number(amount);
  if (!Number.isFinite(inr) || inr <= 0) {
    throw httpError('Amount must be greater than zero', 400, 'InvalidAmount');
  }

  if (!carretLive) {
    // Mock: use the same indicative rate as off-ramp inverted.
    const cryptoAmount = (inr / env.carret.indicativeRate).toFixed(2);
    return {
      amount,
      cryptoAmount,
      rate: String(env.carret.indicativeRate),
      asset: env.carret.crypto,
      fiat: env.carret.fiat,
      provider: 'carret',
      live: false,
      fees: [],
    };
  }

  const routeId = await resolveOnrampRouteId();
  const q = await createOnrampQuote({ routeId, amount }) as {
    id?: number | string;
    output_amount?: { amount?: number };
    base_rate?: number;
    rate_info?: { rate?: number };
    fee_details?: { carret_fee_amount?: number; tax_amount?: number };
    expires_at?: string;
  };
  const rate = q.rate_info?.rate ?? q.base_rate ?? env.carret.indicativeRate;
  const cryptoAmount =
    q.output_amount?.amount !== undefined
      ? String(q.output_amount.amount)
      : (inr / rate).toFixed(2);
  const fees: OnRampQuote['fees'] = [];
  const fee = q.fee_details?.carret_fee_amount;
  const tax = q.fee_details?.tax_amount;
  if (fee) fees.push({ label: 'Carret fee', amount: String(fee), currency: env.carret.fiat });
  if (tax) fees.push({ label: 'Tax', amount: String(tax), currency: env.carret.fiat });
  return {
    amount,
    cryptoAmount,
    rate: String(rate),
    asset: env.carret.crypto,
    fiat: env.carret.fiat,
    provider: 'carret',
    live: true,
    fees,
    expiresAt: q.expires_at,
  };
}

/** POST /v1/onramp/sessions body → creates the Carret order. */
export async function createDeposit(
  userId: string,
  input: { amount: string },
): Promise<OnRampSession> {
  const now = new Date().toISOString();

  if (!carretLive) {
    const s: OnRampSession = {
      id: `on_${Date.now()}_${randomBytes(3).toString('hex')}`,
      userId,
      amount: input.amount,
      cryptoAmount: (Number(input.amount) / env.carret.indicativeRate).toFixed(2),
      asset: env.carret.crypto,
      fiat: env.carret.fiat,
      status: 'open',
      provider: 'carret',
      createdAt: now,
    };
    sessions.set(s.id, s);
    evictOldest(sessions, 5_000);
    return s;
  }

  const mapping = await getMapping(userId);
  if (!mapping) {
    throw httpError('Provision your Carret sub-account first', 422, 'NoMapping');
  }
  const banks = await listBanks(mapping.carretAccountId);
  const verified = banks.find((b) => b.status === 'verified') ?? banks[0];
  if (!verified) {
    throw httpError(
      'Register a verified bank before starting an on-ramp order',
      422,
      'NoBankRegistered',
    );
  }

  const accountId = mapping.carretAccountId;
  const routeId = await resolveOnrampRouteId();
  const quote = await createOnrampQuote({
    routeId,
    amount: input.amount,
    accountId,
  }) as {
    id?: number | string;
    output_amount?: { amount?: number };
  };
  if (!quote.id) throw httpError('Carret did not return a quote id', 502, 'BadUpstream');
  const order = await placeOnrampOrder({ quoteId: quote.id, bankId: verified.id, accountId });

  const cryptoAmount =
    quote.output_amount?.amount !== undefined ? String(quote.output_amount.amount) : undefined;

  const s: OnRampSession = {
    id: `on_${Date.now()}_${randomBytes(3).toString('hex')}`,
    userId,
    amount: input.amount,
    cryptoAmount,
    asset: env.carret.crypto,
    fiat: env.carret.fiat,
    status: order.status ?? 'open',
    provider: 'carret',
    createdAt: now,
    bankLast4: verified.bank_account_no.slice(-4),
    carretOrderId: order.id,
    carretQuoteId: quote.id,
  };
  sessions.set(s.id, s);
  evictOldest(sessions, 5_000);
  return s;
}

export async function getSession(id: string, userId: string): Promise<OnRampSession> {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) {
    throw httpError('On-ramp session not found', 404, 'NotFound');
  }
  if (!carretLive || !s.carretOrderId) return s;
  try {
    const order: CarretOrder = await getOnrampOrder(s.carretOrderId);
    const mapped = mapCarretStatus(order.status);
    s.status = mapped ? order.status : s.status;
  } catch {
    // Best-effort — keep last-known status on transient upstream errors.
  }
  return s;
}

export function listSessions(userId: string, limit = 50): OnRampSessionPage {
  const items = [...sessions.values()]
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return { items };
}

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}
