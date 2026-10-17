import { createVerify } from 'node:crypto';
import { env } from '../config/env.js';
import type { OffRampStatus } from '@pathpulse/contract';

function toBaseUnits(amount: string, decimals: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  const f = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(f || '0')).toString();
}

export function buildOfframpUrl(params: {
  sessionId: string;
  amount: string;
  userAddress?: string;
  callbackBase: string;
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
  const base = toBaseUnits(params.amount, 7);
  if (base) q.set('swapAmount', base);
  q.set('offrampWebhookV3Url', `${params.callbackBase}?ref=${encodeURIComponent(params.sessionId)}`);
  q.set('finalUrl', params.finalUrl);
  return url.toString();
}

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
