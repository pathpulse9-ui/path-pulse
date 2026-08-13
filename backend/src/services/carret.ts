import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, carretLive } from '../config/env.js';
import type { OffRampStatus } from '@pathpulse/contract';

/**
 * Carret Infra off-ramp (D4 · alt provider).
 *
 * Carret Infra is a full-stack crypto↔fiat backend for the Indian corridor
 * (KYC + custodial wallets + INR banking + ramp). Their Supported Assets page
 * lists USDC on Stellar for both on-ramp and off-ramp — a native match for
 * PathPulse's settlement asset, no bridge required.
 *
 * Off-ramp flow (all server-driven, `API-KEY` header, no widget):
 *   1. GET  /supported_routes/            → { id, from_asset, to_asset }[]
 *   2. GET  /exchange_rate/               → indicative rate (optional)
 *   3. POST /offramp/quote/               → { id: quote_id, output_amount, ... }
 *   4. POST /offramp/place_order/         → { id: order_id, status }
 *   5. GET  /offramp/orders/?status=open  → poll; status: open|filled|cancelled|...
 *   ↳ webhook (Partner Dashboard) fires on status transitions
 *
 * Behind an `OffRampProvider` interface (see services/offramp.ts). Live mode
 * (`carretLive`) hits the real REST API; sandbox mode returns shape-accurate
 * mocked responses so the flow is demoable + testable until the API-KEY lands.
 */

// ── Types (shape-faithful to Carret's REST responses) ─────────────────

export interface CarretRoute {
  id: string;
  from_asset: string;
  from_chain?: string;
  to_asset: string;
  is_active: boolean;
}

export interface CarretQuote {
  id: string;
  route_id: string;
  input_amount: string;
  output_amount: string;
  rate_info?: unknown;
  is_expired: boolean;
  expires_at?: string;
}

export type CarretOrderStatus =
  | 'open'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'partially_cancelled';

export interface CarretOrder {
  id: string;
  status: CarretOrderStatus;
  asked_quantity: string;
  blocked_fund?: string;
  payment_method: string;
  bank_id?: string;
  quote_id?: string;
}

interface CarretRoutesResponse {
  results?: CarretRoute[];
}

// ── HTTP client ────────────────────────────────────────────────────────

async function carretFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  init: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  if (!carretLive) throw new Error('carretFetch called without live credentials');
  const url = new URL(env.carret.baseUrl.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'API-KEY': env.carret.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Carret ${method} ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

// ── Live API surface ───────────────────────────────────────────────────

/** GET /supported_routes/ — find the route_id for our corridor (e.g. USDC/Stellar → INR). */
export async function getSupportedRoutes(): Promise<CarretRoute[]> {
  const res = await carretFetch<CarretRoutesResponse | CarretRoute[]>('GET', '/supported_routes/');
  return Array.isArray(res) ? res : res.results ?? [];
}

/** Find our configured USDC/Stellar → INR route id from the live list. */
export async function resolveOfframpRouteId(): Promise<string> {
  const routes = await getSupportedRoutes();
  const from = env.carret.crypto.toUpperCase();
  const chain = env.carret.chain.toLowerCase();
  const to = env.carret.fiat.toUpperCase();
  const match = routes.find(
    (r) =>
      r.is_active &&
      r.from_asset.toUpperCase() === from &&
      r.to_asset.toUpperCase() === to &&
      (!r.from_chain || r.from_chain.toLowerCase() === chain),
  );
  if (!match) {
    throw new Error(
      `Carret: no active off-ramp route for ${from} (${env.carret.chain}) → ${to}. ` +
        `Available: ${routes.map((r) => `${r.from_asset}→${r.to_asset}`).join(', ') || '(none)'}`,
    );
  }
  return match.id;
}

/** POST /offramp/quote/ — locks a rate for 10 minutes; returns quote_id. */
export async function createOfframpQuote(params: {
  routeId: string;
  amount: string;
}): Promise<CarretQuote> {
  return carretFetch<CarretQuote>('POST', '/offramp/quote/', {
    body: {
      account_id: env.carret.accountId,
      route_id: params.routeId,
      amount: params.amount,
    },
  });
}

/** POST /offramp/place_order/ — commits the quote against a registered bank_id. */
export async function placeOfframpOrder(params: {
  quoteId: string;
  bankId: string;
}): Promise<CarretOrder> {
  return carretFetch<CarretOrder>('POST', '/offramp/place_order/', {
    body: {
      account_id: env.carret.accountId,
      quote_id: params.quoteId,
      bank_id: params.bankId,
      payment_method: 'bank_transfer',
    },
  });
}

/** GET /offramp/orders/{id}/ — single-order status poll. */
export async function getOfframpOrder(orderId: string): Promise<CarretOrder> {
  return carretFetch<CarretOrder>('GET', `/offramp/orders/${orderId}/`);
}

// ── Status mapping (Carret → PathPulse OffRampStatus lifecycle) ───────

export function mapCarretStatus(status: string): OffRampStatus | null {
  switch (status) {
    case 'open':
    case 'partially_filled':
      return 'pending_anchor'; // Carret has custody; converting/paying fiat
    case 'filled':
      return 'completed';
    case 'cancelled':
    case 'partially_cancelled':
      return 'error';
    default:
      return null;
  }
}

// ── Webhook verification ──────────────────────────────────────────────

/**
 * Verify a Carret webhook. Carret's public docs don't yet spec the signature
 * scheme — we assume HMAC-SHA256(webhookSecret, rawBody), hex in the
 * `X-Carret-Signature` header (a common Django-webhook default). Update this
 * function once the Partner team confirms the scheme.
 *
 * Until `CARRET_WEBHOOK_SECRET` is set we refuse every webhook — fail-closed
 * (same policy that caught the Mercuryo raw-body bug in v0.1.6.x).
 */
export function verifyCarretWebhook(rawBody: string, signatureHex: string): boolean {
  if (!env.carret.webhookSecret || !signatureHex) return false;
  try {
    const expected = createHmac('sha256', env.carret.webhookSecret).update(rawBody).digest();
    const got = Buffer.from(signatureHex, 'hex');
    if (got.length !== expected.length) return false;
    return timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

// ── Mocked responses (sandbox stub — used when `carretLive` is false) ─

/**
 * Deterministic-per-call mocks that match the live JSON shape so the rest of
 * the code path is exercised identically. Every id gets a fresh random suffix
 * so successive quotes/orders don't collide in the in-memory session index.
 */
function mockId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(3).toString('hex')}`;
}

export const carretMocks = {
  route(): CarretRoute {
    return {
      id: 'route_mock_usdc_stellar_inr',
      from_asset: env.carret.crypto,
      from_chain: env.carret.chain,
      to_asset: env.carret.fiat,
      is_active: true,
    };
  },
  quote(amount: string): CarretQuote {
    const out = (Number(amount) * env.carret.indicativeRate).toFixed(2);
    return {
      id: mockId('quote'),
      route_id: 'route_mock_usdc_stellar_inr',
      input_amount: amount,
      output_amount: out,
      is_expired: false,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      rate_info: { base_rate: env.carret.indicativeRate, carret_fee_factor: 0, tax_factor: 0 },
    };
  },
  order(quoteId: string, amount: string): CarretOrder {
    return {
      id: mockId('ord'),
      status: 'open',
      asked_quantity: amount,
      blocked_fund: amount,
      payment_method: 'bank_transfer',
      bank_id: env.carret.bankId || 'bank_mock_1',
      quote_id: quoteId,
    };
  },
  /** Time-based status progression so polling shows realistic transitions. */
  advanceOrder(createdAtIso: string): CarretOrderStatus {
    const elapsed = (Date.now() - new Date(createdAtIso).getTime()) / 1000;
    if (elapsed < 8) return 'open';
    if (elapsed < 16) return 'partially_filled';
    return 'filled';
  },
};
