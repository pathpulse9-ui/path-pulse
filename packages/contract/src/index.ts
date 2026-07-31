/**
 * @pathpulse/contract — shared API types.
 *
 * These mirror `openapi.yaml` and are the single source of truth consumed by the
 * backend and web. Kotlin/Swift model classes are generated from the OpenAPI spec.
 *
 * Phase 1 (D1) covers: managed accounts, Privy onboarding, delegated signing.
 * Later phases extend this file (payouts, off-ramp, settlement, SCOUT, gov exports).
 */

export type StellarNetwork = 'testnet' | 'mainnet';

/** Protocol-governed distribution accounts. */
export type DistributionAccountRole =
  | 'partner_revenue'
  | 'driver_pool'
  | 'treasury';

export interface DistributionAccount {
  role: DistributionAccountRole;
  publicKey: string;
  /** true once the multisig thresholds/signers are set on-chain (treasury only). */
  multisig: boolean;
  network: StellarNetwork;
}

export interface TreasuryConfig {
  publicKey: string;
  signers: { publicKey: string; weight: number }[];
  thresholds: { low: number; medium: number; high: number };
  network: StellarNetwork;
}

/** A driver's Privy-provisioned managed wallet. */
export interface ManagedWallet {
  userId: string;
  address: string;
  provisioned: boolean;
  network: StellarNetwork;
}

// ── Auth / onboarding ───────────────────────────────────────────────

export interface OnboardRequest {
  /** Privy access token obtained on-device after email/OAuth sign-up. */
  privyToken: string;
}

export interface OnboardResponse {
  userId: string;
  wallet: ManagedWallet;
}

// ── Delegated signing ───────────────────────────────────────────────

/** Client asks the backend to build (and, for managed accounts, sign) a transaction. */
export interface BuildTransactionRequest {
  userId: string;
  operations: TransactionOperation[];
  memo?: string;
}

export type TransactionOperation =
  | { type: 'payment'; destination: string; asset: AssetRef; amount: string }
  | { type: 'createAccount'; destination: string; startingBalance: string }
  | { type: 'changeTrust'; asset: AssetRef; limit?: string };

export interface AssetRef {
  code: string;
  /** null/omitted = native XLM. */
  issuer?: string;
}

export interface BuildTransactionResponse {
  /** base64 XDR of the built (and signed, if delegated) transaction envelope. */
  xdr: string;
  hash: string;
}

export interface SubmitTransactionRequest {
  xdr: string;
}

export interface SubmitTransactionResponse {
  hash: string;
  successful: boolean;
  ledger?: number;
  horizonUrl: string;
}

// ── Common ──────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
}

export interface HealthResponse {
  status: 'ok';
  network: StellarNetwork;
  horizon: string;
  version: string;
}

// ── Settlement engine & SCOUT reputation (D6) ─────────────────────────

/** SCOUT reputation tiers → on-chain reward multipliers. */
export type ScoutTier = 1 | 2 | 3;
export const SCOUT_MULTIPLIER: Record<ScoutTier, number> = { 1: 1.0, 2: 1.2, 3: 1.5 };

export interface SettlementDriverInput {
  userId: string;
  address: string;
  tier: ScoutTier;
}

export interface CreateSettlementBatchRequest {
  /** Gross revenue to settle, as a 7-decimal string. */
  grossAmount: string;
  /** Defaults to native XLM on testnet. */
  asset?: AssetRef;
  drivers: SettlementDriverInput[];
}

/** The deterministic 50 / 30 / 20 split, as 7-decimal strings summing to gross. */
export interface SettlementSplit {
  authorities: string; // 50%
  driverRewards: string; // 30%
  treasury: string; // 20%
}

export interface SettlementDriverPayout {
  userId: string;
  address: string;
  tier: ScoutTier;
  multiplier: number;
  amount: string;
}

export interface SettlementBatch {
  id: string;
  createdAt: string;
  network: StellarNetwork;
  grossAmount: string;
  asset: AssetRef;
  split: SettlementSplit;
  driverPayouts: SettlementDriverPayout[];
  sourceAddress: string;
  authoritiesAddress: string;
  treasuryAddress: string;
  txHash: string;
  horizonUrl: string;
}

export interface SettlementBatchPage {
  items: SettlementBatch[];
  nextCursor: string | null;
}
