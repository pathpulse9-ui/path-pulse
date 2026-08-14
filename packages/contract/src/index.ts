/**
 * @pathpulse/contract — shared API types.
 *
 * These mirror `openapi.yaml` and are the single source of truth consumed by the
 * backend and web. Kotlin/Swift model classes are generated from the OpenAPI spec.
 *
 * Phase 1 (D1) covers: managed accounts, email onboarding, delegated signing.
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

export interface ManagedWallet {
  userId: string;
  address: string;
  provisioned: boolean;
  network: StellarNetwork;
}

// ── Auth ────────────────────────────────────────────────────────────

export interface SessionUser {
  userId: string;
  method: 'google' | 'wallet' | 'guest';
  email?: string;
  address?: string;
}

export interface AuthMeResponse {
  user: SessionUser | null;
}

export interface GoogleVerifyRequest {
  idToken: string;
}

export interface GoogleVerifyResponse {
  userId: string;
  wallet: ManagedWallet;
}

export interface WalletChallengeResponse {
  transaction: string;
  networkPassphrase: string;
}

export interface WalletVerifyRequest {
  transaction: string;
}

export interface WalletVerifyResponse {
  userId: string;
  address: string;
}

export interface GuestSessionResponse {
  userId: string;
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
  payoutBatchId: string;
}

export interface SettlementBatchPage {
  items: SettlementBatch[];
  nextCursor: string | null;
}

// ── SCOUT reputation assets (D6) ──────────────────────────────────────

export interface ScoutTierInfo {
  tier: ScoutTier;
  /** Classic Asset code, e.g. "SCOUT2". */
  code: string;
  multiplier: number;
}

export interface ScoutConfig {
  /** Issuer account of the SCOUT Classic Assets. */
  issuer: string;
  network: StellarNetwork;
  tiers: ScoutTierInfo[];
}

/** Assign a tier from a PulseGen validation score (0..1). */
export interface AssignScoutTierRequest {
  score: number;
}

export interface ScoutAssignment {
  userId: string;
  address: string;
  tier: ScoutTier;
  multiplier: number;
  score: number;
  issuer: string;
  assetCode: string;
  txHash: string;
  horizonUrl: string;
}

export interface ScoutTierLookup {
  address: string;
  tier: ScoutTier | null;
  multiplier: number;
}

// ── Fiat off-ramp (D4 — Mercuryo SEP-24) ──────────────────────────────

/** SEP-24 interactive withdrawal lifecycle (subset used by PathPulse). */
export type OffRampStatus =
  | 'pending_user_transfer_start' // user must send stablecoin to the anchor
  | 'pending_anchor' // anchor is converting + paying out fiat
  | 'completed'
  | 'error';

export interface CreateOffRampWithdrawalRequest {
  /** Stablecoin amount to off-ramp, 7-decimal string. */
  amount: string;
  /** Stablecoin to withdraw (defaults to USDC on testnet). */
  asset?: AssetRef;
  /** Fiat currency to receive (e.g. "INR"). Defaults to the backend's configured corridor. */
  fiatCurrency?: string;
  /** Optional link to the settlement batch this withdrawal draws from. */
  settlementBatchId?: string;
}

export interface OffRampSession {
  id: string;
  provider: 'ramp' | 'mercuryo' | 'carret';
  /** true when running against the sandbox stub (no live provider credentials). */
  sandbox: boolean;
  status: OffRampStatus;
  /** Hosted SEP-24 interactive URL (KYC + bank details + conversion). */
  interactiveUrl: string;
  amount: string;
  asset: AssetRef;
  fiatCurrency: string;
  /** Estimated fiat the user receives, 2-decimal string (indicative). */
  fiatAmountEstimate?: string;
  /** Anchor / deposit account the user sends the crypto to. */
  anchorAccount?: string;
  /** Mercuryo merchant_transaction_id (for status polling + callback correlation). */
  merchantTransactionId?: string;
  settlementBatchId?: string;
  /** Stellar tx of the user's transfer to the anchor, once known. */
  stellarTxHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OffRampSessionPage {
  items: OffRampSession[];
  nextCursor: string | null;
}

// ── Driver payout batches (D2/D3 — Stellar Disbursement Platform) ─────

export type PayoutBatchStatus = 'draft' | 'ready' | 'started' | 'paused' | 'completed' | 'error';

export type PayoutReceiptStatus = 'ready' | 'pending' | 'success' | 'failed';

export interface PayoutReceipt {
  userId: string;
  address: string;
  tier: ScoutTier;
  amount: string;
  status: PayoutReceiptStatus;
  stellarTxHash?: string;
}

export interface PayoutBatch {
  id: string;
  provider: 'sdp';
  sandbox: boolean;
  status: PayoutBatchStatus;
  asset: AssetRef;
  totalAmount: string;
  receipts: PayoutReceipt[];
  settlementBatchId?: string;
  disbursementId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayoutBatchRequest {
  settlementBatchId: string;
}

export interface PayoutBatchPage {
  items: PayoutBatch[];
  nextCursor: string | null;
}
