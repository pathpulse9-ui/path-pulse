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
