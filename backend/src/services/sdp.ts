import type { AssetRef,
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
  if (env.sdp.tenantName) headers['SDP-Tenant-Name'] = env.sdp.tenantName;

  const res = await fetch(url(path), { ...init, headers });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const body = json as { message?: string; error?: string; extras?: unknown } | undefined;
    const detail = body?.extras ? ` ${JSON.stringify(body.extras)}` : '';
    const message = body?.message ?? body?.error ?? res.statusText;
    const e = new Error(`SDP ${path} → ${res.status}: ${message}${detail}`) as Error & {
      status: number;
    };
    e.name = 'SdpError';
    e.status = res.status;
    throw e;
  }
  return json as T;
}

interface SdpAsset {
  id: string;
  code: string;
  issuer: string;
}

export async function resolveAssetId(ref?: AssetRef): Promise<string> {
  if (!ref) return env.sdp.assetId;
  const assets = await call<SdpAsset[]>('/assets');
  const wanted = ref.code.toUpperCase();
  const match = assets.find(
    (a) =>
      a.code.toUpperCase() === wanted &&
      (ref.issuer ? a.issuer === ref.issuer : !a.issuer),
  );
  if (!match) {
    const known = assets.map((a) => `${a.code}${a.issuer ? `-${a.issuer.slice(0, 8)}` : ''}`).join(', ');
    throw new Error(
      `SDP has no asset matching ${ref.code}${ref.issuer ? `-${ref.issuer.slice(0, 8)}` : ''} (registered: ${known})`,
    );
  }
  return match.id;
}

export async function getDistributionAccount(): Promise<string> {
  const org = await call<{ distribution_account_public_key?: string; distribution_account?: { address?: string } }>(
    '/organization',
  );
  const address = org.distribution_account?.address ?? org.distribution_account_public_key;
  if (!address) throw new Error('SDP /organization returned no distribution account');
  return address;
}

export async function assertDistributionIsDriverPool(): Promise<void> {
  const address = await getDistributionAccount();
  if (address !== env.distribution.driverPool) {
    const e = new Error(
      `SDP pays from ${address}, but DRIVER_POOL_PUBLIC is ${env.distribution.driverPool}. On mainnet the driver pool ` +
        'must be the SDP distribution account so the 30% leg and the driver payments are the same funds on-chain.',
    ) as Error & { status: number };
    e.name = 'DriverPoolMismatch';
    e.status = 500;
    throw e;
  }
}

export async function createDisbursement(name: string, asset?: AssetRef): Promise<DisbursementRef> {
  const receiverSuppliesAddress = env.sdp.registrationContactType.endsWith('_AND_WALLET_ADDRESS');
  const assetId = await resolveAssetId(asset);
  return call<DisbursementRef>('/disbursements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      wallet_id: receiverSuppliesAddress ? undefined : env.sdp.walletId,
      asset_id: assetId,
      registration_contact_type: env.sdp.registrationContactType,
      verification_field: receiverSuppliesAddress ? undefined : env.sdp.verificationField,
    }),
  });
}

export async function uploadDisbursementInstructions(
  disbursementId: string,
  payouts: SettlementDriverPayout[],
): Promise<void> {
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
