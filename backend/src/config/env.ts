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

  // dev | aws-kms | gcp-kms | hsm  — Phase 1 uses dev tier.
  signerBackend: process.env.SIGNER_BACKEND ?? 'dev',

  privy: {
    appId: process.env.PRIVY_APP_ID ?? '',
    appSecret: process.env.PRIVY_APP_SECRET ?? '',
  },
} as const;

export const isMainnet = env.network === 'mainnet';
export const horizonTxUrl = (hash: string) =>
  `https://stellar.expert/explorer/${env.network === 'testnet' ? 'testnet' : 'public'}/tx/${hash}`;
