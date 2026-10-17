import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProxyAgent } from 'undici';
import ClassicFormData from 'form-data';
import { env, carretLive, numEnv } from '../config/env.js';
import type { OffRampStatus } from '@pathpulse/contract';

const carretDispatcher: unknown = env.carret.httpsProxy
  ? new ProxyAgent(env.carret.httpsProxy)
  : undefined;

function carretFetchOptions(init: RequestInit): RequestInit {
  const opts: Record<string, unknown> = { signal: AbortSignal.timeout(30_000), ...init };
  if (carretDispatcher) opts.dispatcher = carretDispatcher;
  return opts as RequestInit;
}

export interface CarretRoute {
  id: number | string;
  from_asset: string;
  from_chain?: string;
  to_asset: string;
  is_active: boolean;
}

export interface CarretAmount {
  amount: number;
  currency: string;
}

export interface CarretQuote {
  id: number | string;
  route_id?: number | string;
  route_type?: string;
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

export interface CarretDepositAddress {
  id: number;
  address: string;
  chain: string;
  asset: string;
  memo_label: string | null;
}

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

export interface CarretCryptoDeposit {
  id: number;
  account_id: number;
  asset: string;
  chain: string;
  amount: string;
  actual_amount?: string;
  status: string;
  txn_type: string;
  deposited_from_addr?: string | null;
  txn_id: string;
  created_at?: number;
}

export async function createCryptoDeposit(params: {
  accountId: number | string;
  carretWalletId: number | string;
  asset: string;
  chain: string;
  amount: string;
  txnId: string;
  reason?: string;
}): Promise<CarretCryptoDeposit> {
  const res = await carretFetch<{ message?: string; data?: CarretCryptoDeposit } | CarretCryptoDeposit>(
    'POST',
    '/crypto_deposit/',
    {
      body: {
        account_id: Number(params.accountId),
        asset: params.asset,
        chain: params.chain,
        amount: params.amount,
        carret_wallet_id: Number(params.carretWalletId),
        txn_id: params.txnId,
        declaration_data: {
          is_wallet_owned: true,
          reason_for_transfer: params.reason ?? 'Driver payout settlement',
          acknowledgement: true,
        },
      },
    },
  );
  return (res as { data?: CarretCryptoDeposit }).data ?? (res as CarretCryptoDeposit);
}


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
  created_at?: string | number;
  updated_at?: string | number;
  filled_time?: string | number;
}

interface CarretPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

const RATE_QPS = numEnv('CARRET_RATE_LIMIT_QPS', 10, 1);
let tokens = RATE_QPS;
let lastRefill = Date.now();

async function takeToken(): Promise<void> {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  tokens = Math.min(RATE_QPS, tokens + elapsed * RATE_QPS);
  lastRefill = now;
  if (tokens < 1) {
    const waitMs = Math.ceil(((1 - tokens) / RATE_QPS) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
    tokens = 0;
  } else {
    tokens -= 1;
  }
}

function carretAccountSegment(accountId: number | string): string {
  const id = String(accountId);
  if (!/^\d{1,20}$/.test(id)) {
    const e = new Error('Carret account id must be numeric') as Error & { status: number };
    e.name = 'ValidationError';
    e.status = 400;
    throw e;
  }
  return encodeURIComponent(id);
}

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
  await takeToken();
  const doFetch = () =>
    fetch(
      url.toString(),
      carretFetchOptions({
        method,
        headers: {
          'API-KEY': env.carret.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );
  let res = await doFetch();
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '1');
    await new Promise((r) => setTimeout(r, Math.min(5000, retryAfter * 1000)));
    res = await doFetch();
  }
  if (!res.ok) {
    throw carretHttpError(res.status, await res.text().catch(() => ''), `${method} ${path}`);
  }
  return (await res.json()) as T;
}

export async function getSupportedRoutes(): Promise<CarretRoute[]> {
  const res = await carretFetch<CarretPage<CarretRoute> | CarretRoute[]>(
    'GET',
    '/offramp/supported_routes/',
  );
  return Array.isArray(res) ? res : res.results ?? [];
}

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

export function toCarretAmount(amount: string): string {
  const [whole, frac = ''] = amount.split('.');
  const truncated = (frac + '00').slice(0, 2);
  return `${whole || '0'}.${truncated}`;
}

export async function createOfframpQuote(params: {
  routeId: number | string;
  amount: string;
  accountId?: number | string;
}): Promise<CarretQuote> {
  return carretFetch<CarretQuote>('POST', '/offramp/quote/', {
    body: {
      account_id: params.accountId ?? env.carret.accountId,
      route_id: params.routeId,
      amount: toCarretAmount(params.amount),
    },
  });
}

export async function placeOfframpOrder(params: {
  quoteId: number | string;
  bankId: number | string;
  accountId?: number | string;
}): Promise<CarretOrder> {
  return carretFetch<CarretOrder>('POST', '/offramp/place_order/', {
    body: {
      account_id: params.accountId ?? env.carret.accountId,
      quote_id: params.quoteId,
      bank_id: params.bankId,
      payment_method: 'bank_transfer',
    },
  });
}

export async function listOfframpOrders(
  accountId: number | string = env.carret.accountId,
): Promise<CarretOrder[]> {
  if (!accountId) {
    throw new Error('CARRET_ACCOUNT_ID required to list orders');
  }
  const page = await carretFetch<CarretPage<CarretOrder & { order_type?: string; side?: string }>>(
    'GET',
    '/offramp/orders/',
    { query: { account_id: accountId } },
  );
  return page.results ?? [];
}

export async function getOfframpOrder(
  orderId: number | string,
  accountId: number | string = env.carret.accountId,
): Promise<CarretOrder> {
  const orders = await listOfframpOrders(accountId);
  const match = orders.find((o) => String(o.id) === String(orderId));
  if (!match) {
    throw new Error(`Carret order ${orderId} not found for account ${accountId}`);
  }
  return match;
}


export async function resolveOnrampRouteId(): Promise<number | string> {
  const routes = await getSupportedRoutes();
  const to = env.carret.crypto.toUpperCase();
  const chain = env.carret.chain.toLowerCase();
  const from = env.carret.fiat.toUpperCase();
  const match = routes.find(
    (r) =>
      r.is_active &&
      r.from_asset.toUpperCase() === from &&
      r.to_asset.toUpperCase() === to &&
      (!r.from_chain || r.from_chain.toLowerCase() === chain),
  );
  if (!match) {
    throw new Error(
      `Carret: no active on-ramp route for ${from} → ${to} (${env.carret.chain}). ` +
        `Available: ${routes.map((r) => `${r.from_asset}→${r.to_asset}`).join(', ') || '(none)'}`,
    );
  }
  return match.id;
}

export async function createOnrampQuote(params: {
  routeId: number | string;
  amount: string;
  accountId?: number | string;
}): Promise<CarretQuote> {
  return carretFetch<CarretQuote>('POST', '/onramp/quote/', {
    body: {
      account_id: params.accountId ?? env.carret.accountId,
      route_id: params.routeId,
      amount: params.amount,
    },
  });
}

export async function placeOnrampOrder(params: {
  quoteId: number | string;
  bankId: number | string;
  accountId?: number | string;
}): Promise<CarretOrder> {
  return carretFetch<CarretOrder>('POST', '/onramp/place_order/', {
    body: {
      account_id: params.accountId ?? env.carret.accountId,
      quote_id: params.quoteId,
      bank_id: params.bankId,
      payment_method: 'bank_transfer',
    },
  });
}

export async function getOnrampOrder(orderId: number | string): Promise<CarretOrder> {
  if (!env.carret.accountId) {
    throw new Error('CARRET_ACCOUNT_ID required to fetch order status');
  }
  const page = await carretFetch<CarretPage<CarretOrder>>('GET', '/onramp/orders/', {
    query: { account_id: env.carret.accountId },
  });
  const match = (page.results ?? []).find((o) => String(o.id) === String(orderId));
  if (!match) throw new Error(`Carret on-ramp order ${orderId} not found`);
  return match;
}

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

export interface CarretWalletBalance {
  asset: string;                     // "USDC"
  chain?: string;                    // "stellar"
  balance: string;
  available?: string;
}

export async function listWalletBalances(accountId: number | string): Promise<CarretWalletBalance[]> {
  const res = await carretFetch<unknown>('GET', '/wallet/', {
    query: { account_id: String(accountId) },
  });
  return normalizeWallets(res);
}

function normalizeWallets(res: unknown): CarretWalletBalance[] {
  const items: unknown[] = Array.isArray(res)
    ? res
    : (res as { results?: unknown[]; balances?: unknown[] } | null)?.results
      ?? (res as { balances?: unknown[] } | null)?.balances
      ?? [];
  return items
    .map((raw) => {
      const w = raw as Record<string, unknown>;
      const asset = String(w.asset ?? w.currency ?? w.symbol ?? '').toUpperCase();
      if (!asset) return null;
      const chain = w.chain ?? w.network;
      const balance = String(w.current_balance ?? w.balance ?? w.total ?? w.total_balance ?? '0');
      const available = w.available ?? w.available_balance ?? w.spendable ?? w.current_balance;
      return {
        asset,
        chain: chain ? String(chain) : undefined,
        balance,
        available: available !== undefined ? String(available) : undefined,
      } as CarretWalletBalance;
    })
    .filter((v): v is CarretWalletBalance => v !== null);
}

export async function listBanks(accountId: number | string): Promise<CarretBank[]> {
  const res = await carretFetch<CarretPage<CarretBank> | CarretBank[]>('GET', '/bank/', {
    query: { account_id: String(accountId) },
  });
  return Array.isArray(res) ? res : res.results ?? [];
}

export function carretTimestampMs(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Math.round(v * 1000);
  const asNumber = Number(v);
  if (Number.isFinite(asNumber) && !/[-:TZ]/.test(v)) return Math.round(asNumber * 1000);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
}

export function mapCarretStatus(status: string): OffRampStatus | null {
  switch (status) {
    case 'open':
    case 'partially_filled':
      return 'pending_anchor';
    case 'filled':
      return 'completed';
    case 'cancelled':
    case 'partially_cancelled':
      return 'error';
    default:
      return null;
  }
}

export function verifyCarretWebhook(rawBody: string, signatureHex: string): boolean {
  if (!env.carret.webhookSecret || !signatureHex) return false;
  try {
    const sig = signatureHex.trim().toLowerCase();
    const expected = createHmac('sha256', env.carret.webhookSecret).update(rawBody).digest();
    const got = Buffer.from(sig, 'hex');
    if (got.length !== expected.length) return false;
    return timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

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
  advanceOrder(createdAtIso: string): CarretOrderStatus {
    const elapsed = (Date.now() - new Date(createdAtIso).getTime()) / 1000;
    if (elapsed < 8) return 'open';
    if (elapsed < 16) return 'partially_filled';
    return 'filled';
  },
};

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
  const res = await fetch(
    url,
    carretFetchOptions({
      method,
      headers: {
        'API-KEY': env.carret.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw carretHttpError(res.status, await res.text().catch(() => ''), `${method} ${path}`);
  }
  return (await res.json()) as T;
}

function carretHttpError(status: number, rawText: string, ctx: string): Error {
  const e = new Error() as Error & { status: number; upstream?: string };
  e.name = 'CarretUpstreamError';
  e.upstream = `${status} ${ctx}`;
  const parsed = safeParseJson(rawText);
  const human = extractHumanMessage(parsed) || (typeof parsed === 'string' ? parsed : rawText);
  if (status >= 500) {
    e.status = 503;
    e.message = 'Payments partner is briefly unavailable. Please try again in a few minutes.';
  } else {
    e.status = 422;
    e.message = human && human.length <= 240 ? human : 'Some of the details couldn\'t be accepted.';
  }
  return e;
}

function safeParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function firstString(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = firstString(x);
      if (s) return s;
    }
    return '';
  }
  if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) {
      const s = firstString(x);
      if (s) return s;
    }
  }
  return '';
}

function extractHumanMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const obj = parsed as Record<string, unknown>;

  const specific = firstString(obj.details ?? obj.errors ?? obj.non_field_errors);
  if (specific) return specific;

  const direct = obj.detail ?? obj.message ?? obj.error;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === 'string' && x.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return '';
}

export async function whitelistWallet(
  accountId: number | string,
  address: string,
  chain: string = env.carret.chain,
): Promise<unknown> {
  return carretFetch<unknown>('POST', '/wallet-address/', {
    body: {
      account_id: Number(accountId),
      address,
      chain: chain.toLowerCase(),
    },
  });
}

export async function initiateKyc(accountId: number | string): Promise<CarretKycInitiateResponse> {
  return carretV2Fetch<CarretKycInitiateResponse>('POST', '/kyc/initiate/', {
    account_id: Number(accountId),
  });
}

export async function submitKycDocument(params: {
  kycSessionId: string;
  document: CarretKycDocument;
}): Promise<unknown> {
  return carretV2Fetch<unknown>('POST', '/kyc/document/submit/', {
    kyc_session_id: params.kycSessionId,
    document: params.document,
  });
}

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
  // Anurag (Carret) confirmed 2026-10-15: EVERY doc type goes via `doc_front`
  // with file_type signalling how Carret should parse (xml for Aadhaar XML,
  // image for everything else). The docs' `xml_file` row is wrong; their own
  // curl example uses doc_front. Node 18's built-in FormData+Blob+fetch combo
  // also produced a body Carret's DRF refused with "No file was submitted." —
  // the classic form-data package generates RFC-2388 multipart with explicit
  // Content-Length that DRF reliably routes to request.FILES.
  const form = new ClassicFormData();
  form.append('kyc_session', params.kycSessionId);
  form.append('doc_type', params.docType);
  form.append('file_type', params.fileType);
  form.append('doc_front', params.fileBuffer, {
    filename: params.filename,
    contentType: params.contentType ?? (params.fileType === 'xml' ? 'application/xml' : 'application/octet-stream'),
  });
  if (params.docBack) {
    form.append('doc_back', params.docBack.fileBuffer, {
      filename: params.docBack.filename,
      contentType: params.docBack.contentType ?? 'application/octet-stream',
    });
  }
  const url = carretV2Base() + '/kyc/document_file/submit/';
  const res = await fetch(
    url,
    carretFetchOptions({
      method: 'POST',
      headers: {
        'API-KEY': env.carret.apiKey,
        ...form.getHeaders(),
        'Content-Length': String(form.getLengthSync()),
        Accept: 'application/json',
      },
      // Classic FormData returns a Node stream; wrap in a Buffer for fetch.
      body: form.getBuffer(),
    }),
  );
  if (!res.ok) {
    throw carretHttpError(res.status, await res.text().catch(() => ''), 'POST /kyc/document_file/submit/');
  }
  return res.json();
}

export async function getKycStatus(accountId: number | string): Promise<CarretKycStatusResponse> {
  return carretV2Fetch<CarretKycStatusResponse>('GET', `/kyc/${carretAccountSegment(accountId)}/`);
}

export async function cleanupKyc(accountId: number | string): Promise<unknown> {
  return carretV2Fetch<unknown>('POST', '/kyc/cleanup/', { account_id: Number(accountId) });
}


export interface CarretDigilockerStart {
  success: boolean;
  message: string;
  data: { reference_id: string; url: string };
}

export interface CarretEaadhaarDetails {
  success: boolean;
  message: string;
  data: {
    reference_id: string;
    name: string;
    dob: string;
    address: string;
    maskedAadhaarNumber: string;
    photo: string;
    xmlAadhaarFile: string;
    aadhaarFile: string;
  };
}

export async function startDigilocker(referenceId: string): Promise<CarretDigilockerStart> {
  return carretFetch<CarretDigilockerStart>('POST', '/utility/digilocker/start/', {
    body: { reference_id: referenceId },
  });
}

export async function fetchEaadhaarDetails(referenceId: string): Promise<CarretEaadhaarDetails> {
  return carretFetch<CarretEaadhaarDetails>('POST', '/utility/digilocker/eaadhaar_details/', {
    body: { reference_id: referenceId },
  });
}


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
  dob: string;
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

export async function createSubAccount(input: SubAccountInput): Promise<CarretSubAccount> {
  const phoneDigits = String(input.phone_number).replace(/\D/g, '');
  const body = { ...input, phone_number: Number(phoneDigits) };
  try {
    return await carretFetch<CarretSubAccount>('POST', '/register/', { body });
  } catch (e) {
    if ((e as Error).name !== 'CarretUpstreamError') throw e;
    (e as Error).message = 'The payments partner could not create the account from these details.';
    throw e;
  }
}

export async function getSubAccount(accountId: number | string): Promise<CarretSubAccount> {
  return carretFetch<CarretSubAccount>('GET', `/account/${carretAccountSegment(accountId)}/`);
}
