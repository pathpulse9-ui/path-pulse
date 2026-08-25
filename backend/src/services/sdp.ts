import type {
  PayoutBatchStatus,
  PayoutReceipt,
  PayoutReceiptStatus,
  SettlementDriverPayout,
} from '@pathpulse/contract';
import { env } from '../config/env.js';

interface DisbursementRef {
  id: string;
  status: string;
}

interface DisbursementReceiverRow {
  external_id: string;
  receiver_wallet?: { stellar_address?: string };
  payment?: { status?: string; stellar_transaction_id?: string };
}

function url(path: string): string {
  return `${env.sdp.baseUrl.replace(/\/$/, '')}${path}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  headers.Authorization = env.sdp.apiKey;

  const res = await fetch(url(path), { ...init, headers });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message = (json as { message?: string } | undefined)?.message ?? res.statusText;
    const e = new Error(`SDP ${path} → ${res.status}: ${message}`) as Error & { status: number };
    e.name = 'SdpError';
    e.status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw e;
  }
  return json as T;
}

export async function createDisbursement(name: string): Promise<DisbursementRef> {
  // Receiver-supplied addresses pick the user-managed wallet themselves; SDP
  // rejects an explicit wallet_id for those contact types.
  const receiverSuppliesAddress = env.sdp.registrationContactType.endsWith('_AND_WALLET_ADDRESS');
  return call<DisbursementRef>('/disbursements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      wallet_id: receiverSuppliesAddress ? undefined : env.sdp.walletId,
      asset_id: env.sdp.assetId,
      registration_contact_type: env.sdp.registrationContactType,
      verification_field: receiverSuppliesAddress ? undefined : env.sdp.verificationField,
    }),
  });
}

export async function uploadDisbursementInstructions(
  disbursementId: string,
  payouts: SettlementDriverPayout[],
): Promise<void> {
  // SDP always requires a receiver contact alongside the wallet address. Settlement
  // carries no phone/email, so derive a stable per-driver address from the userId.
  const usesEmail = env.sdp.registrationContactType.startsWith('EMAIL');
  const contact = (userId: string) =>
    usesEmail ? `${userId}@${env.sdp.contactDomain}` : '';
  const header = `id,${usesEmail ? 'email' : 'phone'},amount,walletAddress`;
  const rows = payouts.map((p) => `${p.userId},${contact(p.userId)},${p.amount},${p.address}`);
  const csv = [header, ...rows].join('\n');

  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'instructions.csv');

  await call(`/disbursements/${disbursementId}/instructions`, { method: 'POST', body: form });
}

export async function startDisbursement(disbursementId: string): Promise<void> {
  await call(`/disbursements/${disbursementId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'STARTED' }),
  });
}

export async function getDisbursement(disbursementId: string): Promise<DisbursementRef> {
  return call<DisbursementRef>(`/disbursements/${disbursementId}`);
}

export async function getDisbursementReceivers(disbursementId: string): Promise<DisbursementReceiverRow[]> {
  const res = await call<{ data?: DisbursementReceiverRow[] }>(`/disbursements/${disbursementId}/receivers`);
  return res.data ?? [];
}

export function mapDisbursementStatus(s: string): PayoutBatchStatus {
  switch (s) {
    case 'STARTED':
      return 'started';
    case 'PAUSED':
      return 'paused';
    case 'COMPLETED':
      return 'completed';
    case 'READY':
      return 'ready';
    default:
      return 'draft';
  }
}

export function mapPaymentStatus(s: string | undefined): PayoutReceiptStatus {
  switch (s) {
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
    case 'CANCELED':
      return 'failed';
    case 'PENDING':
      return 'pending';
    default:
      return 'ready';
  }
}

export function mapReceivers(receipts: PayoutReceipt[], rows: DisbursementReceiverRow[]): PayoutReceipt[] {
  const byUserId = new Map(rows.map((r) => [r.external_id, r]));
  return receipts.map((r) => {
    const row = byUserId.get(r.userId);
    if (!row) return r;
    return {
      ...r,
      status: mapPaymentStatus(row.payment?.status),
      stellarTxHash: row.payment?.stellar_transaction_id,
    };
  });
}
