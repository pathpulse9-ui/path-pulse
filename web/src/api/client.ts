import type {
  HealthResponse,
  DistributionAccount,
  TreasuryConfig,
  OnboardResponse,
  SettlementBatch,
  SettlementBatchPage,
  CreateSettlementBatchRequest,
} from '@pathpulse/contract';

/** Base URL of the Backend Core. Override with VITE_API_BASE for staging/prod. */
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err?.message) detail = err.message;
    } catch {
      /* ignore */
    }
    throw new Error(`${path} → ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  health: () => get<HealthResponse>('/health'),
  distributionAccounts: () => get<DistributionAccount[]>('/v1/accounts/distribution'),
  treasuryConfig: () => get<TreasuryConfig>('/v1/treasury/config'),
  onboard: (privyToken: string) => post<OnboardResponse>('/v1/onboard', { privyToken }),
  listSettlementBatches: (limit = 50) =>
    get<SettlementBatchPage>(`/v1/settlement/batches?limit=${limit}`),
  getSettlementBatch: (id: string) => get<SettlementBatch>(`/v1/settlement/batches/${id}`),
  createSettlementBatch: (req: CreateSettlementBatchRequest) =>
    post<SettlementBatch>('/v1/settlement/batches', req),
};
