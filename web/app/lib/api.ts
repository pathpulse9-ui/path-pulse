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
  CreateGroupPayoutRequest,
  OffRampSession,
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
