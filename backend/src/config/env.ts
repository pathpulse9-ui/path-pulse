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

const SIGNER_BACKENDS = ['dev', 'aws-kms', 'gcp-kms', 'hsm'] as const;
export type SignerBackend = (typeof SIGNER_BACKENDS)[number];

const signerBackend = (process.env.SIGNER_BACKEND ?? 'dev') as SignerBackend;
if (!SIGNER_BACKENDS.includes(signerBackend)) {
  throw new Error(`SIGNER_BACKEND must be ${SIGNER_BACKENDS.join('|')}, got: ${signerBackend}`);
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

  signerBackend,

  kms: {
    keyId: process.env.KMS_KEY_ID ?? '',
  },

  databaseUrl: process.env.DATABASE_URL ?? '',
  keyEncryptionKey: process.env.KEY_ENCRYPTION_KEY ?? '',
  keyEncryptionKeyCiphertext: process.env.KEY_ENCRYPTION_KEY_CIPHERTEXT ?? '',

  // Aquarius AMM routing (D5). Testnet only — mainnet pools are gated behind Phase 5.
  routing: {
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    aquaApiUrl: process.env.AQUA_API_URL ?? 'https://amm-api-testnet.aqua.network/api/external/v2',
    aquaRouterContract: process.env.AQUA_ROUTER_CONTRACT ?? '',
    slippageBps: Number(process.env.ROUTING_SLIPPAGE_BPS ?? 100),
  },

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

  // Ramp Network off-ramp (D4). Widget/SDK-based: we build a signed off-ramp widget
  // URL (enabledFlows=OFFRAMP) and receive ECDSA-signed V3 webhooks. All optional —
  // absent an API key ⇒ in-process sandbox stub.
  ramp: {
    apiKey: process.env.RAMP_API_KEY ?? '',
    // Hosted widget origin (staging: app.demo.ramp.network; prod: app.ramp.network).
    widgetUrl: process.env.RAMP_WIDGET_URL ?? 'https://app.demo.ramp.network',
    // Ramp's ECDSA public key (PEM) used to verify webhook X-Body-Signature.
    webhookPublicKey: (process.env.RAMP_WEBHOOK_PUBLIC_KEY ?? '').replace(/\\n/g, '\n'),
    hostAppName: process.env.RAMP_HOST_APP_NAME ?? 'PathPulse',
    // Corridor. Ramp off-ramps XLM on Stellar (Stellar-USDC not in the off-ramp list);
    // INR is supported. Confirm live pairs via Ramp's /offramp/assets.
    crypto: process.env.OFFRAMP_CRYPTO ?? 'XLM',
    // Ramp asset id is CHAIN_SYMBOL, e.g. "XLM_XLM".
    assetId: process.env.OFFRAMP_ASSET_ID ?? 'XLM_XLM',
    fiat: process.env.OFFRAMP_FIAT ?? 'INR',
    // Indicative fiat per 1 crypto unit — sandbox stub estimate only (live: Ramp quote).
    indicativeRate: Number(process.env.OFFRAMP_INDICATIVE_RATE ?? 30),
  },

  // Carret Infra off-ramp (D4 · alt provider). Pure REST, server-driven — no widget.
  // Corridor: USDC on Stellar → INR (bank_transfer). All optional — absent an API key
  // ⇒ in-process sandbox stub that returns shape-accurate mocked Carret responses.
  //
  // Onboarding (external — PAT-27): email contact@carret.in for `dev.carret.in` sandbox
  // API-KEY + Partner Dashboard access; then register the webhook URL there.
  carret: {
    apiKey: process.env.CARRET_API_KEY ?? '',
    // Staging: dev.carret.in ; production: prod.carret.in. Path prefix is
    // /api/v1/taas/ (confirmed via `GET .../taas/main_account/` returning 200).
    baseUrl: process.env.CARRET_BASE_URL ?? 'https://dev.carret.in/api/v1/taas',
    // The Partner account id (main or sub) that owns the trading wallet + orders.
    accountId: process.env.CARRET_ACCOUNT_ID ?? '',
    // Corridor. Carret uses the *token symbol* for `chain` (XLM = Stellar,
    // TRX = Tron, ETH = Ethereum, etc.), not the network name. USDC/XLM is
    // active in both dev and prod as of 2026-08 (routes ids: off-ramp 7,
    // on-ramp 8).
    crypto: process.env.CARRET_CRYPTO ?? 'USDC',
    chain: process.env.CARRET_CHAIN ?? 'XLM',
    fiat: process.env.CARRET_FIAT ?? 'INR',
    // Registered bank_id used for the off-ramp order's bank_transfer payout.
    bankId: process.env.CARRET_BANK_ID ?? '',
    // Optional webhook shared secret (signature scheme TBD — pending Carret docs/team).
    webhookSecret: process.env.CARRET_WEBHOOK_SECRET ?? '',
    // Indicative fiat per 1 crypto unit — sandbox stub estimate only (live: Carret quote).
    indicativeRate: Number(process.env.CARRET_INDICATIVE_RATE ?? 84),
    // DEV-ONLY escape hatch. Carret is mainnet-only (their dev env uses real
    // mainnet USDC). The provider refuses to run when STELLAR_NETWORK=testnet
    // to prevent testnet USDC vanishing into a mainnet deposit address. Setting
    // CARRET_ALLOW_TESTNET=true lets the guard through so devs can click the
    // web UI end-to-end without shipping mainnet — the send just won't reach
    // Carret, but every Carret API call still fires and the order flow works.
    // Never set this in production.
    allowTestnet: process.env.CARRET_ALLOW_TESTNET === 'true',
  },

  // Which off-ramp provider is active: 'ramp' (default, current) or 'carret'.
  offrampProvider: (process.env.OFFRAMP_PROVIDER ?? 'ramp') as 'ramp' | 'carret',

  sdp: {
    baseUrl: process.env.SDP_BASE_URL ?? 'http://localhost:8000',
    apiKey: process.env.SDP_API_KEY ?? '',
    walletId: process.env.SDP_WALLET_ID ?? '',
    assetId: process.env.SDP_ASSET_ID ?? '',
    registrationContactType: process.env.SDP_REGISTRATION_CONTACT_TYPE ?? 'PHONE_NUMBER_AND_WALLET_ADDRESS',
    verificationField: process.env.SDP_VERIFICATION_FIELD ?? 'DATE_OF_BIRTH',
    contactDomain: process.env.SDP_CONTACT_DOMAIN ?? 'pathpulse.local',
  },
} as const;

/** Live Ramp requires a host API key; otherwise the sandbox stub runs. */
export const rampLive = !!process.env.RAMP_API_KEY;

/** Live Carret requires an API-KEY + accountId; otherwise the sandbox stub runs. */
export const carretLive = !!process.env.CARRET_API_KEY && !!process.env.CARRET_ACCOUNT_ID;

export const sdpLive = !!process.env.SDP_API_KEY && !!process.env.SDP_WALLET_ID && !!process.env.SDP_ASSET_ID;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

export const isMainnet = env.network === 'mainnet';

if (isMainnet && env.signerBackend === 'dev') {
  throw new Error('SIGNER_BACKEND=dev is prohibited on mainnet — configure a KMS/HSM backend');
}
export const horizonTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/${env.network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;
