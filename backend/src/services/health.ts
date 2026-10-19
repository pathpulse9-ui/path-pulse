import { env, sdpLive, carretLive } from '../config/env.js';
import { db } from '../db/client.js';
import { sendAlert } from './alerts.js';
import { logger } from '../config/logger.js';

const CHECK_TIMEOUT_MS = 5_000;
const MAX_LEDGER_AGE_S = 60;

export interface HealthCheck {
  name: string;
  run: () => Promise<void>;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  ok: boolean;
  network: string;
  checkedAt: string;
  checks: CheckResult[];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref?.()),
  ]);
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function probeSdp(): Promise<void> {
  await getJson(`${env.sdp.baseUrl}/health`);
}

const SERVICE_ACCOUNT_FLOORS: Array<[string, () => number]> = [
  ['__reserve_sponsor__', () => env.sponsor.minBalanceXlm],
  ['__settlement_source__', () => 1.5],
  ['__routing_swap_source__', () => 1.5],
  ['__scout_issuer__', () => 1.5],
  ['__group_payout_source__', () => 1.5],
];

export function xlmShortfalls(
  balances: Array<{ name: string; address: string; xlm: number }>,
  floors: Map<string, number>,
): string[] {
  return balances
    .filter((b) => b.xlm < (floors.get(b.name) ?? 0))
    .map((b) => `${b.name} ${b.address} holds ${b.xlm} XLM, below ${floors.get(b.name)}`);
}

async function checkServiceBalances(): Promise<void> {
  const { getManagedWallet } = await import('../stellar/managed.js');
  const { horizon } = await import('../stellar/network.js');
  const floors = new Map(SERVICE_ACCOUNT_FLOORS.map(([n, f]) => [n, f()]));
  const balances: Array<{ name: string; address: string; xlm: number }> = [];
  for (const [name] of SERVICE_ACCOUNT_FLOORS) {
    const wallet = await getManagedWallet(name).catch(() => null);
    if (!wallet?.provisioned) continue;
    const acct = await horizon.loadAccount(wallet.address);
    const native = acct.balances.find((b) => b.asset_type === 'native');
    balances.push({ name, address: wallet.address, xlm: Number(native?.balance ?? 0) });
  }
  const short = xlmShortfalls(balances, floors);
  if (short.length) throw new Error(short.join('; '));
}

async function checkServiceSigning(): Promise<void> {
  const { getManagedSigner, getManagedWallet, isServiceAccount, serviceSigningMode } = await import('../stellar/managed.js');
  for (const [name] of SERVICE_ACCOUNT_FLOORS) {
    if (!isServiceAccount(name)) continue;
    const wallet = await getManagedWallet(name).catch(() => null);
    if (wallet?.provisioned) await getManagedSigner(name);
  }
  const seeded = Object.entries(serviceSigningMode()).filter(([, mode]) => mode === 'sealed-seed');
  if (seeded.length) {
    throw new Error(`service accounts still signing with sealed seeds: ${seeded.map(([a]) => a).join(', ')}`);
  }
}

export function defaultChecks(): HealthCheck[] {
  const checks: HealthCheck[] = [
    {
      name: 'horizon',
      run: async () => {
        const body = (await getJson(`${env.horizonUrl}/ledgers?order=desc&limit=1`)) as {
          _embedded?: { records?: Array<{ closed_at: string }> };
        };
        const closedAt = body._embedded?.records?.[0]?.closed_at;
        if (!closedAt) throw new Error('no ledger returned');
        const ageS = (Date.now() - Date.parse(closedAt)) / 1000;
        if (ageS > MAX_LEDGER_AGE_S) throw new Error(`latest ledger is ${Math.round(ageS)}s old`);
      },
    },
  ];
  if (env.databaseUrl) {
    checks.push({ name: 'database', run: async () => void (await db().query('select 1')) });
  }
  if (env.databaseUrl && env.network === 'mainnet' && env.signerBackend === 'aws-kms') {
    checks.push({ name: 'kms-service-signing', run: checkServiceSigning });
  }
  if (sdpLive) checks.push({ name: 'sdp', run: probeSdp });
  if (sdpLive && env.network === 'mainnet') {
    checks.push({
      name: 'sdp-driver-pool',
      run: async () => (await import('./sdp.js')).assertDistributionIsDriverPool(),
    });
  }
  if (carretLive) {
    checks.push({
      name: 'carret',
      run: async () => {
        const routes = await (await import('./carret.js')).getSupportedRoutes();
        if (!routes.length) throw new Error('Carret returned no off-ramp routes');
      },
    });
  }
  if (env.signerBackend === 'aws-kms') {
    checks.push({
      name: 'kms',
      run: async () => {
        const { AwsKmsSigner } = await import('../stellar/kms.js');
        await AwsKmsSigner.create(env.kms.keyId);
      },
    });
  }
  if (env.databaseUrl) checks.push({ name: 'service-balances', run: checkServiceBalances });
  return checks;
}

export async function runChecks(checks: HealthCheck[], timeoutMs = CHECK_TIMEOUT_MS): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async (check): Promise<CheckResult> => {
      const started = Date.now();
      try {
        await withTimeout(check.run(), timeoutMs);
        return { name: check.name, ok: true, latencyMs: Date.now() - started };
      } catch (e) {
        return { name: check.name, ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
      }
    }),
  );
  return {
    ok: results.every((r) => r.ok),
    network: env.network,
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}

export async function notifyTransitions(previous: Map<string, boolean>, report: ReadinessReport): Promise<void> {
  for (const check of report.checks) {
    const was = previous.get(check.name);
    previous.set(check.name, check.ok);
    if (was === undefined && check.ok) continue;
    if (was === check.ok) continue;
    await sendAlert(
      check.ok
        ? { key: `health:${check.name}`, severity: 'resolved', title: `${check.name} recovered` }
        : { key: `health:${check.name}`, severity: 'critical', title: `${check.name} is down`, detail: check.error },
    );
  }
}

let lastReport: ReadinessReport | null = null;

export function lastMonitorReport(): ReadinessReport | null {
  return lastReport;
}

export function startHealthMonitor(intervalMs = env.alerts.healthIntervalMs): void {
  const state = new Map<string, boolean>();
  const tick = () =>
    runChecks(defaultChecks())
      .then((report) => {
        lastReport = report;
        return notifyTransitions(state, report);
      })
      .catch((e) => logger.error({ err: e }, 'health monitor tick failed'));
  void tick();
  setInterval(tick, intervalMs).unref?.();
}
