import type {
  HealthResponse,
  DistributionAccount,
  TreasuryConfig,
} from '@pathpulse/contract';

/** Base URL of the Backend Core. Override with VITE_API_BASE for staging/prod. */
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  health: () => get<HealthResponse>('/health'),
  distributionAccounts: () => get<DistributionAccount[]>('/v1/accounts/distribution'),
  treasuryConfig: () => get<TreasuryConfig>('/v1/treasury/config'),
};
