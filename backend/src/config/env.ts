import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Networks } from '@stellar/stellar-sdk';
import type { StellarNetwork, AssetRef } from '@pathpulse/contract';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../.env');
const envFile = process.env.PATHPULSE_ENV_FILE ? resolve(process.env.PATHPULSE_ENV_FILE) : rootEnv;
if (process.env.PATHPULSE_ENV_FILE && !existsSync(envFile)) {
  throw new Error(`PATHPULSE_ENV_FILE points at ${envFile}, which does not exist`);
}
loadEnv(existsSync(envFile) ? { path: envFile } : {});

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function numEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${name} must be a number >= ${min}, got: ${raw}`);
  }
  return n;
}

const network = (process.env.STELLAR_NETWORK ?? 'testnet') as StellarNetwork;
if (network !== 'testnet' && network !== 'mainnet') {
  throw new Error(`STELLAR_NETWORK must be testnet|mainnet, got: ${network}`);
}

const SIGNER_BACKENDS = ['dev', 'aws-kms'] as const;
export type SignerBackend = (typeof SIGNER_BACKENDS)[number];

const signerBackend = (process.env.SIGNER_BACKEND ?? 'dev') as SignerBackend;
if (!SIGNER_BACKENDS.includes(signerBackend)) {
  throw new Error(`SIGNER_BACKEND must be ${SIGNER_BACKENDS.join('|')}, got: ${signerBackend}`);
}

const CIRCLE_TESTNET_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const CIRCLE_TESTNET_EURC = 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO';
const CIRCLE_MAINNET_USDC = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const CIRCLE_MAINNET_EURC = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
const DEFAULT_ROUTING_ASSETS = `XLM,USDC:${CIRCLE_TESTNET_USDC},EURC:${CIRCLE_TESTNET_EURC}`;
const MAINNET_ROUTING_ASSETS = `XLM,USDC:${CIRCLE_MAINNET_USDC},EURC:${CIRCLE_MAINNET_EURC}`;

export type AccountFunding = 'friendbot' | 'sponsor';

function parseRoutingAssets(raw?: string, fallback = DEFAULT_ROUTING_ASSETS): AssetRef[] {
  return (raw?.trim() || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [code, issuer] = entry.split(':');
      return issuer ? { code, issuer } : { code };
    });
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: numEnv('PORT', 8080, 1),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustProxyHops: numEnv('TRUST_PROXY_HOPS', 1),

  network,
  horizonUrl: req('HORIZON_URL', network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org'),
  friendbotUrl: process.env.FRIENDBOT_URL ?? 'https://friendbot.stellar.org',
  networkPassphrase:
    process.env.NETWORK_PASSPHRASE ??
    (network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC),

  distribution: {
    partnerRevenue: process.env.PARTNER_REVENUE_PUBLIC ?? '',
    driverPool: process.env.DRIVER_POOL_PUBLIC ?? '',
    treasury: process.env.TREASURY_PUBLIC ?? '',
    extraDepositSenders: (process.env.SETTLEMENT_DEPOSIT_SENDERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  treasury: {
    signers: [
      process.env.TREASURY_SIGNER_1_PUBLIC,
      process.env.TREASURY_SIGNER_2_PUBLIC,
      process.env.TREASURY_SIGNER_3_PUBLIC,
    ].filter((s): s is string => !!s),
    thresholds: {
      low: numEnv('TREASURY_THRESHOLD_LOW', 2),
      medium: numEnv('TREASURY_THRESHOLD_MED', 2),
      high: numEnv('TREASURY_THRESHOLD_HIGH', 2),
    },
  },

  signerBackend,

  kms: {
    keyId: process.env.KMS_KEY_ID ?? '',
  },

  mainnetAllow: process.env.STELLAR_MAINNET_ALLOW === 'true',

  databaseUrl: process.env.DATABASE_URL ?? '',
  keyEncryptionKey: process.env.KEY_ENCRYPTION_KEY ?? '',
  keyEncryptionKeyCiphertext: process.env.KEY_ENCRYPTION_KEY_CIPHERTEXT ?? '',

  accountFunding: (process.env.ACCOUNT_FUNDING ?? (network === 'mainnet' ? 'sponsor' : 'friendbot')) as AccountFunding,
  driverTrustlines: parseRoutingAssets(
    process.env.DRIVER_TRUSTLINES,
    `USDC:${network === 'mainnet' ? CIRCLE_MAINNET_USDC : CIRCLE_TESTNET_USDC}`,
  ).filter((a) => a.issuer),

  routing: {
    quoteTimeoutMs: numEnv('ROUTING_QUOTE_TIMEOUT_MS', 3000, 1),
    assets: parseRoutingAssets(process.env.ROUTING_ASSETS, network === 'mainnet' ? MAINNET_ROUTING_ASSETS : DEFAULT_ROUTING_ASSETS),
    settlementAssetCode: (process.env.ROUTING_SETTLEMENT_ASSET ?? 'USDC').toUpperCase(),
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? (network === 'mainnet' ? '' : 'https://soroban-testnet.stellar.org'),
    aquaApiUrl:
      process.env.AQUA_API_URL ??
      (network === 'mainnet'
        ? 'https://amm-api.aqua.network/api/external/v2'
        : 'https://amm-api-testnet.aqua.network/api/external/v2'),
    aquaRouterContract: process.env.AQUA_ROUTER_CONTRACT ?? '',
    slippageBps: Math.min(numEnv('ROUTING_SLIPPAGE_BPS', 100), 1000),
    stellarBroker: {
      partnerKey: process.env.STELLARBROKER_PARTNER_KEY ?? '',
      apiUrl: process.env.STELLARBROKER_API_URL ?? 'https://api.stellar.broker',
    },
  },

  pulseGen: {
    baseUrl: process.env.PULSEGEN_BASE_URL ?? '',
    apiKey: process.env.PULSEGEN_API_KEY ?? '',
    internal: process.env.PATHPULSE_INTERNAL_SCORER === 'true',
  },

  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',

  session: {
    secret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
    cookieName: 'pathpulse_session',
    maxAgeSeconds: 7 * 24 * 60 * 60,
    opsRoleTtlSeconds: numEnv('OPS_ROLE_TTL_SECONDS', 15 * 60),
    partnerRoleTtlSeconds: numEnv('PARTNER_ROLE_TTL_SECONDS', 8 * 60 * 60),
  },

  opsOperators: (process.env.OPS_OPERATORS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes('@') ? s.toLowerCase() : s)),

  indexer: {
    intervalMs: numEnv('INDEXER_INTERVAL_MS', 60_000, 1),
  },

  sponsor: {
    maxAccountsPerHour: numEnv('SPONSOR_MAX_ACCOUNTS_PER_HOUR', 20),
    maxFeeBumpsPerHour: numEnv('SPONSOR_MAX_FEE_BUMPS_PER_HOUR', 300),
    minBalanceXlm: numEnv('SPONSOR_MIN_BALANCE_XLM', 2),
  },

  govPartnerPasscode: process.env.GOV_PARTNER_PASSCODE ?? '',

  opsPasscode: process.env.OPS_PASSCODE ?? '',

  sep10: {
    signingSecret: process.env.SEP10_SIGNING_SECRET ?? '',
    homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'localhost:8080',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },

  ramp: {
    apiKey: process.env.RAMP_API_KEY ?? '',
    widgetUrl: process.env.RAMP_WIDGET_URL ?? 'https://app.demo.ramp.network',
    webhookPublicKey: (process.env.RAMP_WEBHOOK_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
    hostAppName: process.env.RAMP_HOST_APP_NAME ?? 'PathPulse',
    crypto: process.env.OFFRAMP_CRYPTO ?? 'XLM',
    assetId: process.env.OFFRAMP_ASSET_ID ?? 'XLM_XLM',
    fiat: process.env.OFFRAMP_FIAT ?? 'INR',
    indicativeRate: numEnv('OFFRAMP_INDICATIVE_RATE', 30),
  },

  carret: {
    apiKey: process.env.CARRET_API_KEY ?? '',
    baseUrl: process.env.CARRET_BASE_URL ?? 'https://dev.carret.in/api/v1/taas',
    accountId: process.env.CARRET_ACCOUNT_ID ?? '',
    crypto: process.env.CARRET_CRYPTO ?? 'USDC',
    chain: process.env.CARRET_CHAIN ?? 'XLM',
    fiat: process.env.CARRET_FIAT ?? 'INR',
    bankId: process.env.CARRET_BANK_ID ?? '',
    webhookSecret: process.env.CARRET_WEBHOOK_SECRET ?? '',
    httpsProxy: process.env.CARRET_HTTPS_PROXY ?? '',
    indicativeRate: numEnv('CARRET_INDICATIVE_RATE', 84),
    allowTestnet: process.env.CARRET_ALLOW_TESTNET === 'true',
  },

  offrampProvider: (process.env.OFFRAMP_PROVIDER ?? 'ramp') as 'ramp' | 'carret',

  sdp: {
    retryAttempts: Math.min(numEnv('SDP_RETRY_ATTEMPTS', 3, 1), 10),
    retryBaseDelayMs: Math.min(numEnv('SDP_RETRY_BASE_DELAY_MS', 500), 30_000),
    baseUrl: process.env.SDP_BASE_URL ?? 'http://localhost:8000',
    tenantName: process.env.SDP_TENANT_NAME ?? '',
    apiKey: process.env.SDP_API_KEY ?? '',
    walletId: process.env.SDP_WALLET_ID ?? '',
    assetId: process.env.SDP_ASSET_ID ?? '',
    registrationContactType: process.env.SDP_REGISTRATION_CONTACT_TYPE ?? 'PHONE_NUMBER_AND_WALLET_ADDRESS',
    verificationField: process.env.SDP_VERIFICATION_FIELD ?? 'DATE_OF_BIRTH',
    contactDomain: process.env.SDP_CONTACT_DOMAIN ?? 'pathpulse.local',
  },

  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
    healthIntervalMs: numEnv('HEALTH_CHECK_INTERVAL_MS', 60_000, 1),
  },

  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
  },

  push: {
    apns: {
      keyId: process.env.APNS_KEY_ID ?? '',
      teamId: process.env.APNS_TEAM_ID ?? '',
      bundleId: process.env.APNS_BUNDLE_ID ?? '',
      privateKey: (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      production: process.env.APNS_ENV === 'production',
    },
    fcm: {
      projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    },
  },
} as const;

export const apnsLive =
  !!env.push.apns.keyId && !!env.push.apns.teamId && !!env.push.apns.bundleId && !!env.push.apns.privateKey;

export const fcmLive = !!env.push.fcm.projectId && !!env.push.fcm.clientEmail && !!env.push.fcm.privateKey;

export const rampLive = !!process.env.RAMP_API_KEY;

export const carretLive = !!process.env.CARRET_API_KEY && !!process.env.CARRET_ACCOUNT_ID;

export const sdpLive = !!process.env.SDP_API_KEY && !!process.env.SDP_WALLET_ID && !!process.env.SDP_ASSET_ID;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

if (process.env.NODE_ENV === 'production' && !process.env.GOV_PARTNER_PASSCODE) {
  throw new Error('GOV_PARTNER_PASSCODE must be set in production');
}

if (process.env.NODE_ENV === 'production' && !process.env.SEP10_SIGNING_SECRET) {
  throw new Error('SEP10_SIGNING_SECRET must be set in production');
}

if (process.env.NODE_ENV === 'production' && !process.env.OPS_OPERATORS) {
  throw new Error('OPS_OPERATORS must be set in production');
}

if (process.env.NODE_ENV === 'production' && !process.env.OPS_PASSCODE) {
  throw new Error('OPS_PASSCODE must be set in production');
}

if (env.accountFunding !== 'friendbot' && env.accountFunding !== 'sponsor') {
  throw new Error(`ACCOUNT_FUNDING must be friendbot|sponsor, got: ${env.accountFunding}`);
}

export const isMainnet = env.network === 'mainnet';

if (isMainnet) {
  const problems: string[] = [];

  if (env.signerBackend === 'dev') {
    problems.push('SIGNER_BACKEND=dev is prohibited on mainnet — set SIGNER_BACKEND=aws-kms');
  }
  if (env.signerBackend === 'aws-kms' && !env.kms.keyId) {
    problems.push('SIGNER_BACKEND=aws-kms requires KMS_KEY_ID');
  }
  if (!env.databaseUrl) {
    problems.push(
      'DATABASE_URL is required on mainnet — without it settlement batches fall back to an ' +
        'in-memory store and are lost on restart',
    );
  }
  for (const [name, value] of [
    ['PARTNER_REVENUE_PUBLIC', env.distribution.partnerRevenue],
    ['DRIVER_POOL_PUBLIC', env.distribution.driverPool],
    ['TREASURY_PUBLIC', env.distribution.treasury],
  ] as const) {
    if (!value) problems.push(`${name} must be set on mainnet`);
  }
  if (!process.env.SESSION_SECRET) problems.push('SESSION_SECRET must be set on mainnet');
  if (!env.keyEncryptionKeyCiphertext) {
    problems.push('KEY_ENCRYPTION_KEY_CIPHERTEXT must be set on mainnet — driver seeds are sealed only under a KMS-wrapped key');
  }
  if (env.accountFunding !== 'sponsor') {
    problems.push('ACCOUNT_FUNDING must be "sponsor" on mainnet — Friendbot does not exist there');
  }
  if (!env.opsPasscode) problems.push('OPS_PASSCODE must be set on mainnet');
  if (!env.opsOperators.length) problems.push('OPS_OPERATORS must be set on mainnet');
  if (!env.sep10.signingSecret) problems.push('SEP10_SIGNING_SECRET must be set on mainnet');
  if (!process.env.SEP10_HOME_DOMAIN || /localhost|127\.0\.0\.1/.test(env.sep10.homeDomain)) {
    problems.push('SEP10_HOME_DOMAIN must be the public API host on mainnet — it becomes the SCOUT issuer home_domain');
  }
  if (!env.routing.sorobanRpcUrl || !env.routing.aquaRouterContract) {
    problems.push('Aquarius routing on mainnet needs SOROBAN_RPC_URL and AQUA_ROUTER_CONTRACT');
  }
  for (const [name, value] of [
    ['SDP_BASE_URL', process.env.SDP_BASE_URL],
    ['SDP_API_KEY', env.sdp.apiKey],
    ['SDP_WALLET_ID', env.sdp.walletId],
    ['SDP_ASSET_ID', env.sdp.assetId],
  ] as const) {
    if (!value) problems.push(`${name} must be set on mainnet`);
  }
  for (const [name, value] of [
    ['HORIZON_URL', env.horizonUrl],
    ['SOROBAN_RPC_URL', env.routing.sorobanRpcUrl],
    ['WEB_APP_URL', env.webAppUrl],
  ] as const) {
    if (value && !value.startsWith('https://')) problems.push(`${name} must use https on mainnet`);
  }
  if (env.carret.allowTestnet) {
    problems.push('CARRET_ALLOW_TESTNET=true is a dev-only escape hatch and must be false on mainnet');
  }

  if (problems.length) {
    throw new Error(
      `Refusing to start on mainnet — ${problems.length} configuration problem(s):\n  - ${problems.join('\n  - ')}`,
    );
  }
}
export const horizonTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/${env.network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;
