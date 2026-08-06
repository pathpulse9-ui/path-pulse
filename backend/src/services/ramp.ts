import { createVerify } from 'node:crypto';
import { env } from '../config/env.js';
import type { OffRampStatus } from '@pathpulse/contract';

/**
 * Ramp Network off-ramp (D4).
 *
 * Ramp is widget/SDK-based (not a server-side REST sell): we build a signed off-ramp
 * widget URL (enabledFlows=OFFRAMP) that the driver opens; Ramp runs KYC, shows the
 * deposit address, and pays fiat to the driver's bank. Status arrives as ECDSA-signed
 * V3 webhooks to `offrampWebhookV3Url`. We correlate a webhook back to our session via
 * a `ref` query param on that URL (excluded from signature verification, per Ramp).
 *
 * Ramp off-ramps XLM on Stellar and supports INR fiat. Untested against live Ramp until
 * a host API key + webhook public key are provided; gated behind `rampLive`.
 */

function toBaseUnits(amount: string, decimals: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  const f = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(f || '0')).toString();
}

/** Build the hosted Ramp off-ramp widget URL for a session. */
export function buildOfframpUrl(params: {
  sessionId: string;
  amount: string;
  userAddress?: string;
  callbackBase: string; // e.g. https://api.pathpulse.ai/v1/offramp/callback
  finalUrl: string;
}): string {
  const url = new URL(env.ramp.widgetUrl);
  const q = url.searchParams;
  q.set('hostApiKey', env.ramp.apiKey);
  q.set('hostAppName', env.ramp.hostAppName);
  q.set('enabledFlows', 'OFFRAMP');
  q.set('defaultFlow', 'OFFRAMP');
  q.set('offrampAsset', env.ramp.assetId);
  q.set('fiatCurrency', env.ramp.fiat);
  if (params.userAddress) q.set('userAddress', params.userAddress);
  const base = toBaseUnits(params.amount, 7); // XLM = 7 decimals
  if (base) q.set('swapAmount', base);
  // ref correlates the webhook to our session; Ramp excludes URL params from the signature.
  q.set('offrampWebhookV3Url', `${params.callbackBase}?ref=${encodeURIComponent(params.sessionId)}`);
  q.set('finalUrl', params.finalUrl);
  return url.toString();
}

/** Map a Ramp off-ramp sale status/event → our OffRampStatus lifecycle. */
export function mapRampStatus(status: string): OffRampStatus | null {
  switch (status) {
    case 'CREATED':
    case 'INITIALIZED':
    case 'PENDING':
      return 'pending_user_transfer_start';
    case 'CRYPTO_RECEIVED':
    case 'RELEASING':
    case 'FIAT_SENT':
      return 'pending_anchor';
    case 'RELEASED':
    case 'COMPLETED':
      return 'completed';
    case 'EXPIRED':
    case 'CANCELLED':
    case 'FAILED':
    case 'ERROR':
      return 'error';
    default:
      return null;
  }
}

/**
 * Verify a Ramp webhook. Ramp signs the raw JSON body with ECDSA + SHA256; the signature
 * is base64 in the `X-Body-Signature` header, verified against Ramp's public key (PEM).
 * Only the JSON body is signed — exclude any custom URL params (e.g. `ref`).
 */
export function verifyRampWebhook(rawBody: string, signatureB64: string): boolean {
  if (!env.ramp.webhookPublicKey || !signatureB64) return false;
  try {
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(env.ramp.webhookPublicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
