import type {
  HealthResponse,
  GoogleVerifyRequest,
  GoogleVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  GuestSessionResponse,
  AuthMeResponse,
  SettlementBatch,
  SettlementBatchPage,
  CreateSettlementBatchRequest,
  GroupPayoutBatch,
  GroupPayoutBatchPage,
  PayoutBatch,
  PayoutBatchPage,
  CreateGroupPayoutRequest,
  OffRampSession,
  OffRampQuote,
  OffRampSessionPage,
  CreateOffRampWithdrawalRequest,
  ScoutConfig,
  ScoutAssignment,
  ScoutTierLookup,
  RoutingQuote,
  RoutingSwapRequest,
  RoutingSwapResult,
} from '@pathpulse/contract';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text}`);
  }
  return res.json();
}

export function getHealth() {
  return apiFetch<HealthResponse>('/health');
}

export function verifyGoogleIdToken(idToken: string) {
  const body: GoogleVerifyRequest = { idToken };
  return apiFetch<GoogleVerifyResponse>('/v1/auth/google/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getWalletChallenge(account: string) {
  return apiFetch<WalletChallengeResponse>(
    `/v1/auth/challenge?account=${encodeURIComponent(account)}`,
  );
}

export function verifyWalletChallenge(transaction: string) {
  const body: WalletVerifyRequest = { transaction };
  return apiFetch<WalletVerifyResponse>('/v1/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function continueAsGuest() {
  return apiFetch<GuestSessionResponse>('/v1/auth/guest', { method: 'POST' });
}

export function getSessionUser() {
  return apiFetch<AuthMeResponse>('/v1/auth/me');
}

export function logout() {
  return apiFetch<{ ok: true }>('/v1/auth/logout', { method: 'POST' });
}

// ── Settlement (D6) ───────────────────────────────────────────────────

export function listSettlementBatches(limit = 50) {
  return apiFetch<SettlementBatchPage>(`/v1/settlement/batches?limit=${limit}`);
}

export function getSettlementBatch(id: string) {
  return apiFetch<SettlementBatch>(`/v1/settlement/batches/${id}`);
}

export function createSettlementBatch(req: CreateSettlementBatchRequest) {
  return apiFetch<SettlementBatch>('/v1/settlement/batches', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Group payouts (bulk CSV/Excel upload) ─────────────────────────────

export function listGroupPayouts(limit = 50) {
  return apiFetch<GroupPayoutBatchPage>(`/v1/settlement/group-payouts?limit=${limit}`);
}

export function getGroupPayout(id: string) {
  return apiFetch<GroupPayoutBatch>(`/v1/settlement/group-payouts/${id}`);
}

export function createGroupPayout(req: CreateGroupPayoutRequest) {
  return apiFetch<GroupPayoutBatch>('/v1/settlement/group-payouts', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── Off-ramp (D4 — Carret Infra, USDC on Stellar → INR) ──────────────

export function listOffRampSessions(limit = 50) {
  return apiFetch<OffRampSessionPage>(`/v1/offramp/sessions?limit=${limit}`);
}

export function getOffRampSession(id: string) {
  return apiFetch<OffRampSession>(`/v1/offramp/sessions/${id}`);
}

export function createOffRampWithdrawal(req: CreateOffRampWithdrawalRequest) {
  return apiFetch<OffRampSession>('/v1/offramp/sessions', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ── SCOUT reputation assets (D6) ──────────────────────────────────────

export function getScoutConfig() {
  return apiFetch<ScoutConfig>('/v1/scout');
}

export function assignScoutTier(score: number) {
  return apiFetch<ScoutAssignment>('/v1/scout/assign', {
    method: 'POST',
    body: JSON.stringify({ score }),
  });
}

export function getScoutTier(address: string) {
  return apiFetch<ScoutTierLookup>(`/v1/scout/${address}`);
}

// ── Aquarius liquidity routing (D5) ───────────────────────────────────

export function getRoutingQuote(from: string, to: string, amount: string) {
  const q = new URLSearchParams({ from, to, amount });
  return apiFetch<RoutingQuote>(`/v1/routing/quote?${q}`);
}

export function executeRoutingSwap(req: RoutingSwapRequest) {
  return apiFetch<RoutingSwapResult>('/v1/routing/swap', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function getOffRampQuote(amount: string) {
  return apiFetch<OffRampQuote>(`/v1/offramp/quotes?amount=${encodeURIComponent(amount)}`);
}

// ── SDP institutional payouts (D3) ────────────────────────────────────

export function listPayoutBatches(limit = 50) {
  return apiFetch<PayoutBatchPage>(`/v1/ops/payouts/batches?limit=${limit}`);
}

export function getPayoutBatch(id: string) {
  return apiFetch<PayoutBatch>(`/v1/ops/payouts/batches/${id}`);
}

export function createPayoutBatch(settlementBatchId: string) {
  return apiFetch<PayoutBatch>('/v1/ops/payouts/batches', {
    method: 'POST',
    body: JSON.stringify({ settlementBatchId }),
  });
}

// ── Carret KYC (D4 · dev-onboarding) ─────────────────────────────────

export interface CarretSubAccountInput {
  email: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  annual_income: string;
  country: string;
  gender: 'male' | 'female' | 'other';
  occupation: string;
  dob: string; // dd/mm/yyyy
  is_email_verified?: boolean;
  is_mobile_number_verified?: boolean;
  is_politicaly_exposed_person?: boolean;
}

export interface CarretSubAccountResponse {
  id: number;
  reference_id: string;
  kyc_status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  aml_status: string;
  user: { id: number; email: string; first_name: string; last_name: string };
}

export interface CarretKycSession {
  session_id: string;
  status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  initiated_at: string;
}

export interface CarretKycInitiate {
  success: boolean;
  message: string;
  session: CarretKycSession;
}

export interface CarretKycOvd {
  document_type: string;
  status?: string;
  [k: string]: unknown;
}

export interface CarretKycStatus {
  kyc_session?: string;
  kyc_status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  ovd_documents?: CarretKycOvd[];
}

export function createCarretSubAccount(input: CarretSubAccountInput) {
  return apiFetch<CarretSubAccountResponse>('/v1/carret/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      is_email_verified: true,
      is_mobile_number_verified: true,
      is_politicaly_exposed_person: false,
      ...input,
    }),
  });
}

export function initiateCarretKyc(accountId: number | string) {
  return apiFetch<CarretKycInitiate>('/v1/carret/kyc/initiate', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
  });
}

export function submitCarretKycDocument(kycSessionId: string, document: {
  document_type: 'pan' | 'aadhaar' | 'voter_id' | 'passport' | 'driving_license' | 'selfie';
  document_number?: string;
  name?: string;
  dob?: string;
  surname_from_passport?: string;
  file_number?: string;
  date_of_issue?: string;
}) {
  return apiFetch<unknown>('/v1/carret/kyc/document', {
    method: 'POST',
    body: JSON.stringify({ kyc_session_id: kycSessionId, document }),
  });
}

export async function uploadCarretKycFile(params: {
  kycSession: string;
  docType: 'pan' | 'aadhaar' | 'voter_id' | 'passport' | 'driving_license' | 'selfie';
  fileType: 'image' | 'xml';
  file: File;
  docBack?: File;
}): Promise<unknown> {
  const form = new FormData();
  form.append('kyc_session', params.kycSession);
  form.append('doc_type', params.docType);
  form.append('file_type', params.fileType);
  form.append('doc_front', params.file, params.file.name);
  if (params.docBack) form.append('doc_back', params.docBack, params.docBack.name);
  const res = await fetch(`${API_BASE_URL}/v1/carret/kyc/file`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

export function getCarretKycStatus(accountId: number | string) {
  return apiFetch<CarretKycStatus>(`/v1/carret/kyc/status/${accountId}`);
}

export function cleanupCarretKyc(accountId: number | string) {
  return apiFetch<unknown>('/v1/carret/kyc/cleanup', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
  });
}
