import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env, carretLive } from '../config/env.js';
import type { OffRampStatus } from '@pathpulse/contract';

/**
 * Carret Infra off-ramp (D4 · alt provider).
 *
 * Carret Infra is a full-stack crypto↔fiat backend for the Indian corridor
 * (KYC + custodial wallets + INR banking + ramp). Base path is
 * `/api/v1/taas/` (Transactions-as-a-Service).
 *
 * Off-ramp flow (all server-driven, `API-KEY` header, no widget):
 *   1. GET  /offramp/supported_routes/    → DRF page of { id, from_asset, to_asset }[]
 *   2. GET  /exchange_rate/               → indicative rate (optional)
 *   3. POST /offramp/quote/               → { id: quote_id, output_amount, ... }
 *   4. POST /offramp/place_order/         → { id: order_id, status }
 *   5. GET  /offramp/orders/{id}/         → poll; status: open|filled|cancelled|...
 *   ↳ webhook (Partner Dashboard) fires on status transitions
 *
 * Corridor: prod target is USDC on Stellar; dev is USDT/TRX until Carret
 * activates USDC/Stellar on the dev environment (per their Supported Assets
 * page, which lists it — the dev route list currently omits it).
 *
 * Behind an `OffRampProvider` interface (see services/offramp.ts). Live mode
 * (`carretLive`) hits the real REST API; sandbox mode returns shape-accurate
 * mocked responses so the flow is demoable + testable without live creds.
 */

// ── Types (shape-faithful to Carret's REST responses) ─────────────────

export interface CarretRoute {
  /** Carret returns numeric ids in staging; loosened to string|number for safety. */
  id: number | string;
  from_asset: string;
  from_chain?: string;
  to_asset: string;
  is_active: boolean;
}

/** Carret returns amounts as `{ amount, currency }` objects, not strings. */
export interface CarretAmount {
  amount: number;
  currency: string;
}

export interface CarretQuote {
  id: number | string;
  route_id?: number | string;
  route_type?: string;
  /** Epoch seconds (float) from the live API, e.g. 1786713764.782149. */
  created_at?: number | string;
  amount?: number | string;
  base_rate?: number;
  carret_fee_factor?: number;
  tax_factor?: number;
  asset?: string;
  fiat?: string;
  type?: string;
  input_amount: CarretAmount;
  output_amount: CarretAmount;
  gross_output_amount?: CarretAmount;
  rate_info?: { rate?: number; conversion?: string } | unknown;
  is_expired: boolean;
  expires_at?: string;
}

// ── Deposit addresses (where PathPulse sends crypto for off-ramp) ─────

export interface CarretDepositAddress {
  id: number;
  address: string;
  chain: string;
  asset: string;
  /**
   * Stellar-style memo used to identify our account when we deposit. On
   * Stellar this is a numeric string; other chains may return null.
   * If present, EVERY deposit tx MUST include it or Carret can't credit us.
   */
  memo_label: string | null;
}

/** GET /deposit_addresses/?asset=X&chain=Y — Carret's crypto deposit surface. */
export async function getDepositAddresses(
  asset: string,
  chain: string,
): Promise<CarretDepositAddress[]> {
  const res = await carretFetch<{ data?: CarretDepositAddress[] } | CarretDepositAddress[]>(
    'GET',
    '/deposit_addresses/',
    { query: { asset, chain } },
  );
  if (Array.isArray(res)) return res;
  return res.data ?? [];
}

/**
 * Fetch the single deposit address for our configured corridor. Throws with
 * a helpful message if Carret has no active wallet for the asset/chain (e.g.
 * "No active wallet address found for USDC on stellar" — hint: use 'XLM').
 */
export async function getConfiguredDepositAddress(): Promise<CarretDepositAddress> {
  const list = await getDepositAddresses(env.carret.crypto, env.carret.chain);
  if (!list.length) {
    throw new Error(
      `Carret: no active deposit address for ${env.carret.crypto} on ${env.carret.chain} — ` +
        `verify CARRET_CHAIN uses the token symbol (XLM for Stellar, TRX for Tron, etc.)`,
    );
  }
  return list[0];
}

// ── Banking ────────────────────────────────────────────────────────────

export interface CarretBank {
  id: number;
  account_id: number;
  status: 'verified' | 'pending' | 'failed' | string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_account_name: string;
  bank_name: string;
}

export type CarretOrderStatus =
  | 'open'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'partially_cancelled';

export interface CarretOrder {
  id: number | string;
  status: CarretOrderStatus;
  asked_quantity: string;
  blocked_fund?: string;
  payment_method: string;
  bank_id?: number | string;
  quote_id?: number | string;
}

/** DRF-style pagination envelope Carret returns for list endpoints. */
interface CarretPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
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

/** GET /offramp/supported_routes/ — DRF-paged list of active off-ramp routes. */
export async function getSupportedRoutes(): Promise<CarretRoute[]> {
  const res = await carretFetch<CarretPage<CarretRoute> | CarretRoute[]>(
    'GET',
    '/offramp/supported_routes/',
  );
  return Array.isArray(res) ? res : res.results ?? [];
}

/**
 * Find our configured `from_asset → to_asset` route id from the live list.
 * Chain match is best-effort: staging responses omit `from_chain`, so we only
 * enforce it when the route object carries it. Chain is really determined by
 * the deposit wallet we later fund, not by the route.
 */
export async function resolveOfframpRouteId(): Promise<number | string> {
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

/**
 * Normalize a PathPulse 7-decimal Stellar amount to Carret's ≤2-decimal wire
 * format. Truncates (does NOT round up) so we never send more crypto than the
 * user requested. `"12.5000000"` → `"12.50"`, `"0.0000001"` → `"0.00"`.
 */
export function toCarretAmount(amount: string): string {
  const [whole, frac = ''] = amount.split('.');
  const truncated = (frac + '00').slice(0, 2);
  return `${whole || '0'}.${truncated}`;
}

/** POST /offramp/quote/ — locks a rate for 10 minutes; returns quote_id. */
export async function createOfframpQuote(params: {
  routeId: number | string;
  amount: string;
}): Promise<CarretQuote> {
  return carretFetch<CarretQuote>('POST', '/offramp/quote/', {
    body: {
      account_id: env.carret.accountId,
      route_id: params.routeId,
      amount: toCarretAmount(params.amount),
    },
  });
}

/** POST /offramp/place_order/ — commits the quote against a registered bank_id. */
export async function placeOfframpOrder(params: {
  quoteId: number | string;
  bankId: number | string;
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

/**
 * GET /offramp/orders/?account_id=<id> — Carret has no single-order-by-id
 * retrieval endpoint; we list orders for the account and filter by id. Wasteful
 * on accounts with many orders but works today; a targeted endpoint would be
 * nice-to-have.
 */
export async function getOfframpOrder(orderId: number | string): Promise<CarretOrder> {
  if (!env.carret.accountId) {
    throw new Error('CARRET_ACCOUNT_ID required to fetch order status');
  }
  const page = await carretFetch<CarretPage<CarretOrder & { order_type?: string; side?: string }>>(
    'GET',
    '/offramp/orders/',
    { query: { account_id: env.carret.accountId } },
  );
  const match = (page.results ?? []).find((o) => String(o.id) === String(orderId));
  if (!match) {
    throw new Error(`Carret order ${orderId} not found for account ${env.carret.accountId}`);
  }
  return match;
}

/** POST /bank/ — register a bank on the given account; returns the new bank id. */
export async function registerBank(params: {
  accountId: number | string;
  bankAccountNo: string;
  bankIfsc: string;
  bankAccountName: string;
  bankName: string;
}): Promise<CarretBank> {
  return carretFetch<CarretBank>('POST', '/bank/', {
    body: {
      account_id: Number(params.accountId),
      bank_account_no: params.bankAccountNo,
      bank_ifsc: params.bankIfsc,
      bank_account_name: params.bankAccountName,
      bank_name: params.bankName,
    },
  });
}

/** GET /bank/?account_id=<id> — list registered banks for an account. */
export async function listBanks(accountId: number | string): Promise<CarretBank[]> {
  const res = await carretFetch<CarretPage<CarretBank> | CarretBank[]>('GET', '/bank/', {
    query: { account_id: String(accountId) },
  });
  return Array.isArray(res) ? res : res.results ?? [];
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
    const outNumeric = Number(amount) * env.carret.indicativeRate;
    return {
      id: mockId('quote'),
      route_id: 'route_mock_usdc_stellar_inr',
      route_type: 'offramp',
      created_at: Date.now() / 1000,
      amount: Number(amount),
      base_rate: env.carret.indicativeRate,
      carret_fee_factor: 0,
      tax_factor: 0,
      asset: env.carret.crypto,
      fiat: env.carret.fiat,
      type: 'sell',
      input_amount: { amount: Number(amount), currency: env.carret.crypto },
      output_amount: { amount: outNumeric, currency: env.carret.fiat },
      is_expired: false,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      rate_info: { rate: env.carret.indicativeRate, conversion: `1 ${env.carret.crypto} = ${env.carret.indicativeRate} ${env.carret.fiat}` },
    };
  },
  order(quoteId: number | string, amount: string): CarretOrder {
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

// ── KYC (Carret Infra v2.0 — user-onboarding endpoints) ───────────────
//
// KYC lives under /api/v2.0/taas/ (NOT /v1/ like everything else). We derive
// the v2 base URL from the configured v1 base by string swap — same host,
// same auth header. Every KYC call needs an accountId that's already
// registered but still `kyc_status: pending`.

/** Compute the v2.0 base URL from the configured v1 one (same host). */
function carretV2Base(): string {
  return env.carret.baseUrl.replace(/\/v1\//, '/v2.0/').replace(/\/+$/, '');
}

export interface CarretKycSession {
  session_id: string;
  status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  initiated_at: string;
}

export interface CarretKycInitiateResponse {
  success: boolean;
  message: string;
  session: CarretKycSession;
}

export type CarretKycDocType =
  | 'pan'
  | 'aadhaar'
  | 'voter_id'
  | 'passport'
  | 'driving_license'
  | 'selfie';

export interface CarretKycDocument {
  document_type: CarretKycDocType;
  status?: string;
  document_number?: string;
  name?: string;
  dob?: string;
  surname_from_passport?: string;
  file_number?: string;
  date_of_issue?: string;
  [k: string]: unknown;
}

export interface CarretKycStatusResponse {
  kyc_session?: string;
  kyc_status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  ovd_documents?: CarretKycDocument[];
  [k: string]: unknown;
}

async function carretV2Fetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!carretLive) throw new Error('carretV2Fetch called without live credentials');
  const url = carretV2Base() + path;
  const res = await fetch(url, {
    method,
    headers: {
      'API-KEY': env.carret.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Carret ${method} ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

/** POST /kyc/initiate/ — creates a session for the given account. */
export async function initiateKyc(accountId: number | string): Promise<CarretKycInitiateResponse> {
  return carretV2Fetch<CarretKycInitiateResponse>('POST', '/kyc/initiate/', {
    account_id: Number(accountId),
  });
}

/**
 * POST /kyc/document/submit/ — number-based document (PAN, Voter ID, Passport,
 * Driving License). Aadhaar is XML-file-based, use uploadKycFile for that.
 */
export async function submitKycDocument(params: {
  kycSessionId: string;
  document: CarretKycDocument;
}): Promise<unknown> {
  return carretV2Fetch<unknown>('POST', '/kyc/document/submit/', {
    kyc_session_id: params.kycSessionId,
    document: params.document,
  });
}

/**
 * POST /kyc/document_file/submit/ — multipart upload for Aadhaar XML,
 * selfie, or scanned images. Uses global FormData/Blob (Node 18+).
 * `docBack` is optional; used for double-sided IDs like Aadhaar images.
 */
export async function uploadKycFile(params: {
  kycSessionId: string;
  docType: CarretKycDocType;
  fileType: 'image' | 'xml';
  filename: string;
  fileBuffer: Buffer;
  contentType?: string;
  docBack?: { filename: string; fileBuffer: Buffer; contentType?: string };
}): Promise<unknown> {
  if (!carretLive) throw new Error('uploadKycFile called without live credentials');
  const form = new FormData();
  form.append('kyc_session', params.kycSessionId);
  form.append('doc_type', params.docType);
  form.append('file_type', params.fileType);
  form.append(
    'doc_front',
    new Blob([new Uint8Array(params.fileBuffer)], {
      type: params.contentType ?? (params.fileType === 'xml' ? 'application/xml' : 'application/octet-stream'),
    }),
    params.filename,
  );
  if (params.docBack) {
    form.append(
      'doc_back',
      new Blob([new Uint8Array(params.docBack.fileBuffer)], {
        type: params.docBack.contentType ?? 'application/octet-stream',
      }),
      params.docBack.filename,
    );
  }
  const url = carretV2Base() + '/kyc/document_file/submit/';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'API-KEY': env.carret.apiKey,
      // Do NOT set Content-Type — fetch fills it with the multipart boundary.
      Accept: 'application/json',
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Carret POST /kyc/document_file/submit/ failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** GET /kyc/{account_id}/ — poll for status transitions. */
export async function getKycStatus(accountId: number | string): Promise<CarretKycStatusResponse> {
  return carretV2Fetch<CarretKycStatusResponse>('GET', `/kyc/${accountId}/`);
}

/** POST /kyc/cleanup/ — wipes session + docs for a failed KYC attempt. */
export async function cleanupKyc(accountId: number | string): Promise<unknown> {
  return carretV2Fetch<unknown>('POST', '/kyc/cleanup/', { account_id: Number(accountId) });
}

// ── Sub-account creation (v1) ─────────────────────────────────────────

export interface SubAccountInput {
  email: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  user_ip_address: string;
  annual_income: string;
  is_email_verified: boolean;
  is_mobile_number_verified: boolean;
  country: string;
  gender: 'male' | 'female' | 'other';
  occupation: string;
  is_politicaly_exposed_person: boolean;
  dob: string; // dd/mm/yyyy
}

export interface CarretSubAccount {
  id: number;
  reference_id: string;
  kyc_status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  aml_status: string;
  country: string;
  phone_number: string;
  user: { id: number; email: string; first_name: string; last_name: string };
  banks?: unknown[];
  wallets?: unknown[];
  [k: string]: unknown;
}

/** POST /register/ — creates a sub-account under the main API-KEY. Irreversible (no DELETE endpoint). */
export async function createSubAccount(input: SubAccountInput): Promise<CarretSubAccount> {
  return carretFetch<CarretSubAccount>('POST', '/register/', { body: input });
}
