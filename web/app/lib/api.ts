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
  ScoutRevocation,
  ScoutTierLookup,
  RoutingQuote,
  RoutingSwapRequest,
  RoutingSwapResult,
  PartnerLoginResponse,
  OpsLoginResponse,
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
    throw toApiError(res.status, text);
  }
  return res.json();
}

export class ApiError extends Error {
  readonly status: number;
  readonly needsAuth: boolean;
  readonly needsOperator: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.needsAuth = status === 401;
    this.needsOperator = status === 403;
  }
}

function toApiError(status: number, rawText: string): ApiError {
  // Always try for a friendly sentence first — this unpacks the backend's
  // {error, message, requestId} envelope AND the DRF field-error JSON that
  // Carret 4xx bodies embed inside `message` ({"field":["msg", ...]}) so the
  // UI never has to render "{\"email\":[\"…\"]}" verbatim.
  const friendly = extractFriendlyError(rawText);

  // Auth/permission still get their own overrides so the UI can route the
  // user to sign-in / ops access instead of just displaying the raw copy.
  if (status === 401) return new ApiError(status, 'Sign in to continue.');
  if (status === 403) return new ApiError(status, 'This action needs an operator session — use Ops access in the top bar.');
  if (status === 404) return new ApiError(status, friendly || 'Not found.');
  if (status >= 500) return new ApiError(status, friendly || 'The service is briefly unavailable. Please try again.');
  return new ApiError(status, friendly || 'That request could not be completed.');
}

/**
 * Best-effort extraction of a human sentence from any error body the
 * backend hands us — plain string, {message: "..."}, {detail: "..."},
 * or Carret's DRF field-error shape {"field":["msg", ...]}.
 * Returns "" when nothing is readable — caller then falls back to a
 * per-status sentence.
 */
function extractFriendlyError(raw: string): string {
  const parsed = safeJson(raw);
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const outer = firstString(obj.message) ?? firstString(obj.detail) ?? firstString(obj.error);
    if (outer) {
      // Outer message may itself be a JSON blob (Carret DRF field errors).
      const inner = safeJson(outer);
      const innerMsg = extractDrf(inner);
      if (innerMsg) return innerMsg;
      if (!outer.startsWith('{')) return outer;
    }
    const drf = extractDrf(parsed);
    if (drf) return drf;
  }
  const trimmed = raw.trim();
  return trimmed && !trimmed.startsWith('{') ? trimmed : '';
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function extractDrf(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string, unknown>;
  for (const key of ['detail', 'message', 'error']) {
    const s = firstString(obj[key]);
    if (s) return s;
  }
  for (const val of Object.values(obj)) {
    const s = firstString(val);
    if (s) return s;
    if (Array.isArray(val)) {
      const first = val.find((x) => typeof x === 'string' && x.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
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

export function partnerLogin(passcode: string) {
  return apiFetch<PartnerLoginResponse>('/v1/auth/partner/login', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export function opsLogin(passcode: string) {
  return apiFetch<OpsLoginResponse>('/v1/auth/ops/login', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
}

export function getSessionUser() {
  return apiFetch<AuthMeResponse>('/v1/auth/me');
}

export function logout() {
  return apiFetch<{ ok: true }>('/v1/auth/logout', { method: 'POST' });
}

// ── Settlement (D6) ───────────────────────────────────────────────────

export interface BatchListParams {
  cursor?: string;
  limit?: number;
  network?: string;
  assetCode?: string;
  since?: string;
  until?: string;
  minAmount?: string;
  maxAmount?: string;
}

export function listSettlementBatches(params: BatchListParams | number = {}) {
  // Backwards-compat: legacy call sites pass a bare `limit` number.
  const p: BatchListParams = typeof params === 'number' ? { limit: params } : params;
  const qs = new URLSearchParams();
  if (p.cursor)    qs.set('cursor', p.cursor);
  qs.set('limit', String(p.limit ?? 50));
  if (p.network)   qs.set('network', p.network);
  if (p.assetCode) qs.set('assetCode', p.assetCode);
  if (p.since)     qs.set('since', p.since);
  if (p.until)     qs.set('until', p.until);
  if (p.minAmount) qs.set('minAmount', p.minAmount);
  if (p.maxAmount) qs.set('maxAmount', p.maxAmount);
  return apiFetch<SettlementBatchPage>(`/v1/settlement/batches?${qs}`);
}

export function getSettlementBatch(id: string) {
  return apiFetch<SettlementBatch>(`/v1/settlement/batches/${id}`);
}

/** Direct download URL — the browser handles the actual GET (no fetch needed). */
export function settlementCsvUrl(params: BatchListParams = {}): string {
  const qs = new URLSearchParams();
  if (params.network)   qs.set('network', params.network);
  if (params.assetCode) qs.set('assetCode', params.assetCode);
  if (params.since)     qs.set('since', params.since);
  if (params.until)     qs.set('until', params.until);
  if (params.minAmount) qs.set('minAmount', params.minAmount);
  if (params.maxAmount) qs.set('maxAmount', params.maxAmount);
  const q = qs.toString();
  return `${API_BASE_URL}/v1/settlement/batches/export.csv${q ? `?${q}` : ''}`;
}

export function settlementReceiptPdfUrl(id: string): string {
  return `${API_BASE_URL}/v1/settlement/batches/${id}/receipt.pdf`;
}

export function getTreasuryConfig() {
  return apiFetch<import('@pathpulse/contract').TreasuryConfig>('/v1/treasury/config');
}

export function listDistributionAccounts() {
  return apiFetch<import('@pathpulse/contract').DistributionAccount[]>('/v1/accounts/distribution');
}

// PAT-80: Carret daily-limit tracking. Shape mirrors backend's
// services/carretLimits.ts. `remaining` values are ₹ available today.
export interface CarretLimits {
  carretAccountId: string;
  dailyCapInr: number;
  remaining: {
    deposit_inr: number;
    withdraw_inr: number;
    deposit_crypto: number;
    withdraw_crypto: number;
  };
}
export function getCarretLimits() {
  return apiFetch<CarretLimits>('/v1/carret/limits');
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

export function revokeScoutTier(address: string) {
  return apiFetch<ScoutRevocation>('/v1/scout/revoke', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

export function getScoutTier(address: string) {
  return apiFetch<ScoutTierLookup>(`/v1/scout/${address}`);
}

// ── Cross-asset liquidity routing (D5) ────────────────────────────────

export function getRoutableAssets() {
  return apiFetch<{ items: { symbol: string; code: string; issuer?: string }[] }>(
    '/v1/routing/assets',
  );
}

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

export interface PayoutAttempt {
  id: number;
  batch_id: string;
  disbursement_id: string | null;
  step: string;
  attempt: number;
  outcome: 'success' | 'failure';
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export function listPayoutAttempts(batchId: string) {
  return apiFetch<{ batchId: string; attempts: PayoutAttempt[] }>(
    `/v1/ops/payouts/batches/${batchId}/attempts`,
  );
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

/**
 * POST /v1/carret/provision-subaccount — session-authed find-or-create.
 * `existed` is true when the backend adopted an existing Carret account
 * (either same session, or same email from an earlier install/browser).
 */
export interface CarretProvisionResponse {
  carretAccountId: string;
  kycStatus: 'pending' | 'verified' | 'rejected' | 'manual_review';
  existed: boolean;
}

/** GET /v1/carret/resume — hydrates saved state; null when nothing saved. */
export interface CarretResumeResponse {
  carretAccountId: string;
  kycStatus: 'pending' | 'verified' | 'rejected' | 'manual_review';
  email?: string;
  referenceId?: string;
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
  return apiFetch<CarretProvisionResponse>('/v1/carret/provision-subaccount', {
    method: 'POST',
    body: JSON.stringify({
      is_email_verified: true,
      is_mobile_number_verified: true,
      is_politicaly_exposed_person: false,
      ...input,
    }),
  });
}

/**
 * Fetch any saved KYC application for this session (or the driver's email
 * from an earlier install/browser). Returns null when nothing is on file
 * yet — the backend responds 204 in that case.
 */
export async function resumeCarretKyc(): Promise<CarretResumeResponse | null> {
  const res = await fetch(`${API_BASE_URL}/v1/carret/resume`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw toApiError(res.status, text);
  }
  return (await res.json()) as CarretResumeResponse;
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

/**
 * GET /v1/carret/kyc/status/{accountId}. Backend proxies Carret's raw
 * envelope `{success, kyc_info: {kyc_status, kyc_session, ovd_documents}}`.
 * Callers want the inner `kyc_info`, so unwrap before returning. Previously
 * we tried to decode the envelope directly as CarretKycStatus, silently
 * ended up with `undefined` on every poll, and the wizard sat forever on
 * "Verifying your identity" even after Carret marked the account verified.
 */
export async function getCarretKycStatus(accountId: number | string): Promise<CarretKycStatus> {
  const raw = await apiFetch<{ success?: boolean; kyc_info?: CarretKycStatus } & CarretKycStatus>(
    `/v1/carret/kyc/status/${accountId}`,
  );
  return raw.kyc_info ?? raw;
}

export function cleanupCarretKyc(accountId: number | string) {
  return apiFetch<unknown>('/v1/carret/kyc/cleanup', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId }),
  });
}

/**
 * One registered bank on the driver's Carret sub-account. Status flips from
 * pending → verified after Carret's ₹1 penny-drop test lands (~a minute).
 */
export interface CarretBank {
  id: number;
  account_id: number;
  status: 'verified' | 'pending' | 'failed' | string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_account_name: string;
  bank_name: string;
}

export function listCarretBanks() {
  return apiFetch<{ items: CarretBank[] }>('/v1/carret/banks');
}

export function registerCarretBank(bank: {
  bank_account_no: string;
  bank_ifsc: string;
  bank_account_name: string;
  bank_name: string;
}) {
  return apiFetch<CarretBank>('/v1/carret/banks', {
    method: 'POST',
    body: JSON.stringify(bank),
  });
}
