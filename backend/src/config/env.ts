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

  // Mercuryo On/Off-Ramp B2B REST API (D4). NOTE: Mercuryo is a card-based ramp
  // (sign-in → sell-rates → sell → hosted redirect + callbacks), NOT a Stellar
  // SEP-24 anchor. All optional — absent credentials ⇒ in-process sandbox stub.
  mercuryo: {
    apiUrl: process.env.MERCURYO_API_URL ?? 'https://sandbox-api.mrcr.io/v1.6',
    // Sdk-Partner-Token: signs sign-up / sign-in (from your integration manager).
    sdkPartnerToken: process.env.MERCURYO_SDK_PARTNER_TOKEN ?? '',
    // Callback (webhook) HMAC key used to verify the X-Signature header.
    callbackSignKey: process.env.MERCURYO_CALLBACK_SIGN_KEY ?? '',
    partnerName: process.env.MERCURYO_PARTNER_NAME ?? 'PathPulse',
    // Corridor. Mercuryo supports USDC on Stellar; off-ramp fiat is EUR/USD (NOT INR).
    // Confirm the exact network label + pairs via GET /b2b/currencies.
    crypto: process.env.OFFRAMP_CRYPTO ?? 'USDC',
    network: process.env.OFFRAMP_NETWORK ?? 'STELLAR',
    fiat: process.env.OFFRAMP_FIAT ?? 'EUR',
    // Indicative fiat per 1 USDC — sandbox stub estimate only (live uses sell-rates).
    indicativeRate: Number(process.env.OFFRAMP_INDICATIVE_RATE ?? 0.92),
  },

  sdp: {
    baseUrl: process.env.SDP_BASE_URL ?? 'http://localhost:8000',
    apiKey: process.env.SDP_API_KEY ?? '',
    walletId: process.env.SDP_WALLET_ID ?? '',
    assetId: process.env.SDP_ASSET_ID ?? '',
    registrationContactType: process.env.SDP_REGISTRATION_CONTACT_TYPE ?? 'PHONE_NUMBER_AND_WALLET_ADDRESS',
    verificationField: process.env.SDP_VERIFICATION_FIELD ?? 'DATE_OF_BIRTH',
  },
} as const;

/** Live Mercuryo requires the SDK partner token + API URL; otherwise the sandbox stub runs. */
export const mercuryoLive = !!process.env.MERCURYO_SDK_PARTNER_TOKEN && !!process.env.MERCURYO_API_URL;

export const sdpLive = !!process.env.SDP_API_KEY && !!process.env.SDP_WALLET_ID && !!process.env.SDP_ASSET_ID;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

export const isMainnet = env.network === 'mainnet';
export const horizonTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/${env.network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;
