import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Mercuryo On/Off-Ramp B2B REST client (spec v1.6).
 *
 * IMPORTANT: Mercuryo is a **card-based** ramp, not a Stellar SEP-24 anchor. Off-ramp
 * ("sell") flow: sign-in (Sdk-Partner-Token) → GET /b2b/oor/sell-rates (trx_token) →
 * POST /b2b/oor/sell (hosted redirect_url) → user binds card + sends crypto to the
 * deposit address surfaced in the redirect → Mercuryo pays fiat to the card. Status
 * comes from GET /b2b/transactions and asynchronous callbacks (X-Signature verified).
 *
 * Untested against the live sandbox until an Sdk-Partner-Token + whitelisted IP are
 * provided (external onboarding). Faithful to the spec; gated behind `mercuryoLive`.
 */

interface MercuryoUser {
  userUuid: string;
  bearerToken: string;
}

interface SellRate {
  trxToken: string;
  cryptoCurrency: string;
  cryptoAmount: string;
  fiatCurrency: string;
  fiatAmount: string;
  rate: string;
  feeFiat?: string;
}

interface SellStart {
  merchantTransactionId: string;
  redirectUrl: string;
}

export type MercuryoTxStatus = 'pending' | 'failed' | 'cancelled' | 'succeeded';

function url(path: string): string {
  return `${env.mercuryo.apiUrl.replace(/\/$/, '')}${path}`;
}

async function call<T>(
  path: string,
  init: RequestInit & { auth: 'partner' | 'bearer'; bearer?: string; userIp?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': env.mercuryo.partnerName,
  };
  if (init.auth === 'partner') headers['Sdk-Partner-Token'] = env.mercuryo.sdkPartnerToken;
  else headers['B2B-Bearer-Token'] = init.bearer ?? '';
  if (init.userIp) headers['B2B-User-Ip'] = init.userIp;

  const res = await fetch(url(path), { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as { status?: number; data?: unknown; message?: string };
  if (!res.ok) {
    const e = new Error(`Mercuryo ${path} → ${res.status}: ${json.message ?? res.statusText}`) as Error & {
      status: number;
    };
    e.name = 'MercuryoError';
    e.status = res.status === 401 ? 401 : 502;
    throw e;
  }
  return json.data as T;
}

/** Sign in an existing Mercuryo user by email, or sign up (accepting ToS) if new. */
export async function signInOrSignUp(email: string, userIp?: string): Promise<MercuryoUser> {
  try {
    const d = await call<{ user_uuid4: string; bearer_token: string }>('/b2b/user/sign-in', {
      method: 'POST',
      auth: 'partner',
      userIp,
      body: JSON.stringify({ email }),
    });
    return { userUuid: d.user_uuid4, bearerToken: d.bearer_token };
  } catch {
    // Not found → sign up. `accept` records the user's ToS consent (collected on our UI).
    const d = await call<{ user_uuid4: string; bearer_token: string }>('/b2b/user/sign-up', {
      method: 'POST',
      auth: 'partner',
      userIp,
      body: JSON.stringify({ email, accept: true }),
    });
    return { userUuid: d.user_uuid4, bearerToken: d.bearer_token };
  }
}

/** Frozen off-ramp quote (trx_token expires in ~1h). */
export async function getSellRate(
  bearer: string,
  fromCrypto: string,
  toFiat: string,
  amountFrom: string,
  network?: string,
): Promise<SellRate> {
  const qs = new URLSearchParams({ from: fromCrypto, to: toFiat, amount_from: amountFrom, payment_alias: 'card' });
  if (network) qs.set('network', network);
  // sell-rates returns an array of quotes; take the first.
  const arr = await call<Array<Record<string, unknown>>>(`/b2b/oor/sell-rates?${qs}`, { method: 'GET', auth: 'bearer', bearer });
  const r = (Array.isArray(arr) ? arr[0] : (arr as unknown)) as Record<string, string> & { fee?: Record<string, string> };
  return {
    trxToken: r.trx_token,
    cryptoCurrency: r.currency,
    cryptoAmount: r.amount,
    fiatCurrency: r.fiat_currency,
    fiatAmount: r.fiat_amount,
    rate: r.rate,
    feeFiat: r.fee?.[toFiat],
  };
}

/** Start the sell: returns the hosted redirect where the user binds a card + gets the deposit address. */
export async function startSell(
  bearer: string,
  trxToken: string,
  refundAddress: string,
  merchantTransactionId: string,
  userIp?: string,
): Promise<SellStart> {
  const qs = new URLSearchParams({
    trx_token: trxToken,
    address: refundAddress,
    merchant_transaction_id: merchantTransactionId,
  });
  const d = await call<{ merchant_transaction_id: string; redirect_url: string }>(`/b2b/oor/sell?${qs}`, {
    method: 'POST',
    auth: 'bearer',
    bearer,
    userIp,
  });
  return { merchantTransactionId: d.merchant_transaction_id, redirectUrl: d.redirect_url };
}

export async function getTransactionStatus(
  bearer: string,
  merchantTransactionId: string,
): Promise<MercuryoTxStatus | null> {
  const rows = await call<Array<{ status: MercuryoTxStatus }>>(
    `/b2b/transactions?merchant_transaction_id=${encodeURIComponent(merchantTransactionId)}`,
    { method: 'GET', auth: 'bearer', bearer },
  );
  return rows?.[0]?.status ?? null;
}

/**
 * Verify a Mercuryo callback. The X-Signature header is sha256 HMAC of the raw JSON
 * body keyed by the widget sign_key. Compare in constant time.
 */
export function verifyCallbackSignature(rawBody: string, signatureHeader: string): boolean {
  if (!env.mercuryo.callbackSignKey || !signatureHeader) return false;
  const expected = createHmac('sha256', env.mercuryo.callbackSignKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map Mercuryo transaction status → our OffRampStatus lifecycle. */
export function mapMercuryoStatus(s: MercuryoTxStatus | null): 'pending_anchor' | 'completed' | 'error' | null {
  switch (s) {
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return 'error';
    case 'pending':
      return 'pending_anchor';
    default:
      return null;
  }
}
