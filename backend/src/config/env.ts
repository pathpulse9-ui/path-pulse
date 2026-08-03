import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Networks } from '@stellar/stellar-sdk';
import type { StellarNetwork } from '@pathpulse/contract';

// The shared .env lives at the monorepo root, but the backend runs with cwd=backend/.
// Load the root .env explicitly, falling back to cwd for CI/prod env injection.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../.env'); // backend/src/config → repo root
loadEnv(existsSync(rootEnv) ? { path: rootEnv } : {});

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const network = (process.env.STELLAR_NETWORK ?? 'testnet') as StellarNetwork;
if (network !== 'testnet' && network !== 'mainnet') {
  throw new Error(`STELLAR_NETWORK must be testnet|mainnet, got: ${network}`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  network,
  horizonUrl: req('HORIZON_URL', 'https://horizon-testnet.stellar.org'),
  friendbotUrl: process.env.FRIENDBOT_URL ?? 'https://friendbot.stellar.org',
  networkPassphrase:
    process.env.NETWORK_PASSPHRASE ??
    (network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC),

  distribution: {
    partnerRevenue: process.env.PARTNER_REVENUE_PUBLIC ?? '',
    driverPool: process.env.DRIVER_POOL_PUBLIC ?? '',
    treasury: process.env.TREASURY_PUBLIC ?? '',
  },

  treasury: {
    signers: [
      process.env.TREASURY_SIGNER_1_PUBLIC,
      process.env.TREASURY_SIGNER_2_PUBLIC,
      process.env.TREASURY_SIGNER_3_PUBLIC,
    ].filter((s): s is string => !!s),
    thresholds: {
      low: Number(process.env.TREASURY_THRESHOLD_LOW ?? 2),
      medium: Number(process.env.TREASURY_THRESHOLD_MED ?? 2),
      high: Number(process.env.TREASURY_THRESHOLD_HIGH ?? 2),
    },
  },

  signerBackend: process.env.SIGNER_BACKEND ?? 'dev',

  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',

  session: {
    secret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
    cookieName: 'pathpulse_session',
    maxAgeSeconds: 7 * 24 * 60 * 60,
  },

  sep10: {
    signingSecret: process.env.SEP10_SIGNING_SECRET ?? '',
    homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'localhost:8080',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  },

  // Mercuryo SEP-24 off-ramp (D4). All optional — when credentials are absent the
  // off-ramp runs against an in-process sandbox stub (external-dependency guard).
  mercuryo: {
    // SEP-24 transfer server (anchor TRANSFER_SERVER_SEP0024) + its home domain / TOML.
    sep24TransferServer: process.env.MERCURYO_SEP24_URL ?? '',
    homeDomain: process.env.MERCURYO_HOME_DOMAIN ?? '',
    // Widget/API credentials (used to sign the hosted interactive URL).
    widgetId: process.env.MERCURYO_WIDGET_ID ?? '',
    secret: process.env.MERCURYO_SECRET ?? '',
    baseUrl: process.env.MERCURYO_BASE_URL ?? '',
    // Corridor defaults.
    defaultFiat: process.env.OFFRAMP_FIAT ?? 'INR',
    // Indicative fiat received per 1 stablecoin unit (sandbox estimate only).
    indicativeRate: Number(process.env.OFFRAMP_INDICATIVE_RATE ?? 83),
    defaultAsset: {
      code: process.env.OFFRAMP_ASSET_CODE ?? 'USDC',
      issuer: process.env.OFFRAMP_ASSET_ISSUER ?? '',
    },
  },
} as const;

/** Live Mercuryo requires both a transfer server and signing credentials; else sandbox stub. */
export const mercuryoLive =
  !!process.env.MERCURYO_SEP24_URL && !!process.env.MERCURYO_WIDGET_ID && !!process.env.MERCURYO_SECRET;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

export const isMainnet = env.network === 'mainnet';
export const horizonTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/${env.network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;
