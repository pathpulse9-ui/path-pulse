import type {
  MagicLinkRequest,
  MagicLinkRequestResponse,
  MagicLinkVerifyRequest,
  MagicLinkVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  AuthMeResponse,
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

export function requestMagicLink(email: string) {
  const body: MagicLinkRequest = { email };
  return apiFetch<MagicLinkRequestResponse>('/v1/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyMagicLink(token: string) {
  const body: MagicLinkVerifyRequest = { token };
  return apiFetch<MagicLinkVerifyResponse>('/v1/auth/magic-link/verify', {
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

export function getSessionUser() {
  return apiFetch<AuthMeResponse>('/v1/auth/me');
}

export function logout() {
  return apiFetch<{ ok: true }>('/v1/auth/logout', { method: 'POST' });
}
