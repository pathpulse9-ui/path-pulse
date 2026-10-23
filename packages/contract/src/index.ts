
export type StellarNetwork = 'testnet' | 'mainnet';

export type DistributionAccountRole =
  | 'partner_revenue'
  | 'driver_pool'
  | 'treasury';

export interface DistributionAccount {
  role: DistributionAccountRole;
  publicKey: string;
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

export interface SessionUser {
  userId: string;
  method: 'google' | 'wallet' | 'guest' | 'partner' | 'ops';
  role?: 'ops' | 'partner';
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

export interface PasscodeLoginRequest {
  passcode: string;
}

export interface PartnerLoginResponse {
  userId: string;
}

export interface OpsLoginResponse {
  userId: string;
}

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
  issuer?: string;
}

export interface BuildTransactionResponse {
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

export type ScoutTier = 1 | 2 | 3;
export const SCOUT_MULTIPLIER: Record<ScoutTier, number> = { 1: 1.0, 2: 1.2, 3: 1.5 };

export interface SettlementDriverInput {
  userId: string;
  address: string;
  tier?: ScoutTier;
}

export interface CreateSettlementBatchRequest {
  grossAmount: string;
  asset?: AssetRef;
  drivers: SettlementDriverInput[];
  depositTxHash?: string;
  depositMemo?: string;
}

export interface SettlementDeposit {
  txHash: string;
  from: string;
  amount: string;
  receivedAt: string;
}

export interface SettlementSplit {
  authorities: string;
  driverRewards: string;
  treasury: string;
}

export interface SettlementDriverPayout {
  userId: string;
  address: string;
  tier: ScoutTier;
  multiplier: number;
  amount: string;
  score?: number;
  scoreSource?: ScoreSource;
  scoredAt?: string;
  scoreImportId?: string;
  payoutTxHash?: string;
}

export interface SettlementConversion {
  provider: RoutingProviderName;
  from: AssetRef;
  sourceAmount: string;
  convertedAmount: string;
  swapTxHashes: string[];
  transferTxHash?: string;
}

export type SettlementBatchStatus = 'submitted' | 'confirmed' | 'failed';

export interface SettlementBatch {
  id: string;
  status?: SettlementBatchStatus;
  createdBy?: string;
  approvedBy?: string;
  deposit?: SettlementDeposit;
  conversion?: SettlementConversion;
  createdAt: string;
  network: StellarNetwork;
  grossAmount: string;
  asset: AssetRef;
  split: SettlementSplit;
  driverPayouts: SettlementDriverPayout[];
  sourceAddress: string;
  authoritiesAddress: string;
  driverPoolAddress: string;
  treasuryAddress: string;
  txHash: string;
  horizonUrl: string;
  payoutBatchId?: string;
}

export interface OpsApproval {
  id: string;
  action: 'settlement' | 'converted_settlement' | 'group_payout';
  requestBody: unknown;
  amount: string;
  requestedBy: string;
  approvedBy: string | null;
  status: 'pending' | 'executing' | 'executed' | 'failed' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export function isOpsApproval(value: unknown): value is OpsApproval {
  return typeof value === 'object' && value !== null && String((value as { id?: unknown }).id).startsWith('apr_');
}

export interface CreateConvertedSettlementRequest {
  from: string;
  amount: string;
  drivers: CreateSettlementBatchRequest['drivers'];
  provider?: RoutingProviderName;
}

export interface LedgerEntry {
  id: string;
  account: string;
  role: string;
  txHash: string;
  type: string;
  from: string;
  to: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  createdAt: string;
  direction: 'in' | 'out';
  settlementBatchId: string | null;
  link: 'settlement' | 'deposit' | 'conversion' | null;
}

export interface LedgerPage {
  indexer: { at: string; indexed: number; error?: string } | null;
  items: LedgerEntry[];
  nextCursor: string | null;
}

export interface SettlementBatchPage {
  items: SettlementBatch[];
  nextCursor: string | null;
}

export interface ScoutTierInfo {
  tier: ScoutTier;
  code: string;
  multiplier: number;
}

export interface ScoutConfig {
  issuer: string;
  network: StellarNetwork;
  tiers: ScoutTierInfo[];
}

export type ScoreSource = 'pulsegen' | 'derived' | 'pathpulse-internal';

export interface ValidationScore {
  driverId: string;
  score: number;
  scoredAt: string;
  source: ScoreSource;
}

export interface ScoreImportRecord {
  id: string;
  supplier: string;
  sourceRef?: string;
  notes?: string;
  payloadSha256: string;
  scoreCount: number;
  importedBy: string;
  receivedAt: string;
  createdAt: string;
}

export type ScoreFeedMode = 'pulsegen-live' | 'pulsegen-batch' | 'derived';

export interface ScoutAssignmentRecord {
  driverId: string;
  address: string;
  tier: number;
  multiplier: number;
  score: number | null;
  scoreSource: string | null;
  scoreImportId: string | null;
  assetCode: string;
  issuer: string;
  txHash: string;
  horizonUrl: string | null;
  createdAt: string;
}

export interface ScoreFeedStatus {
  pulseGenLive: boolean;
  endpointHost: string | null;
  mode: ScoreFeedMode;
  scoredDrivers: number;
  latestImport: ScoreImportRecord | null;
  scores: (ValidationScore & { importId: string | null })[];
  assignments: ScoutAssignmentRecord[];
}

export interface AssignScoutTierRequest {
  driverId: string;
}

export interface ScoutAssignment {
  userId: string;
  address: string;
  tier: ScoutTier;
  multiplier: number;
  score: number;
  scoredAt: string;
  scoreSource: ScoreSource;
  scoreImportId?: string;
  issuer: string;
  assetCode: string;
  txHash: string;
  horizonUrl: string;
}

export interface ScoutRevocation {
  address: string;
  revokedTier: ScoutTier;
  assetCode: string;
  issuer: string;
  clawedBackAmount: string;
  txHash: string;
  horizonUrl: string;
}

export interface GroupPayoutRecipient {
  name: string;
  address: string;
  amount: string;
  remark?: string;
}

export interface CreateGroupPayoutRequest {
  asset?: AssetRef;
  recipients: GroupPayoutRecipient[];
  memo?: string;
}

export interface GroupPayoutReceipt {
  name: string;
  address: string;
  amount: string;
  remark?: string;
}

export interface GroupPayoutBatch {
  id: string;
  createdBy?: string;
  createdAt: string;
  network: StellarNetwork;
  asset: AssetRef;
  totalAmount: string;
  sourceAddress: string;
  memo?: string;
  receipts: GroupPayoutReceipt[];
  txHash?: string;
  horizonUrl?: string;
  payoutBatchId?: string;
  disbursementId?: string;
}

export interface ScoutTierLookup {
  address: string;
  tier: ScoutTier | null;
  multiplier: number;
}

export interface GroupPayoutBatchPage {
  items: GroupPayoutBatch[];
  nextCursor: string | null;
}

export type OffRampStatus =
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'completed'
  | 'error';

export interface CreateOffRampWithdrawalRequest {
  amount: string;
  asset?: AssetRef;
  fiatCurrency?: string;
  settlementBatchId?: string;
}

export interface OffRampSession {
  id: string;
  provider: 'ramp' | 'mercuryo' | 'carret';
  sandbox: boolean;
  status: OffRampStatus;
  interactiveUrl: string;
  amount: string;
  asset: AssetRef;
  fiatCurrency: string;
  fiatAmountEstimate?: string;
  anchorAccount?: string;
  merchantTransactionId?: string;
  settlementBatchId?: string;
  stellarTxHash?: string;
  stellarTxUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpsOffRampSession {
  id: string;
  userId: string;
  provider: string;
  status: OffRampStatus;
  amount: string;
  assetCode: string;
  fiatCurrency: string;
  settlementBatchId: string | null;
  carretOrderId: string | null;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export type OffRampEventSource = 'create' | 'poll' | 'webhook' | 'reconciler';

export interface OffRampStatusEventRecord {
  sessionId: string;
  previousStatus: OffRampStatus | null;
  status: OffRampStatus;
  source: OffRampEventSource;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface ReconcileOutcomeRecord {
  sessionId: string;
  settlementBatchId: string | null;
  carretOrderId: string | null;
  matchedBy: 'order_id' | 'amount_and_time' | null;
  from: string;
  to: string | null;
  action: 'recovered' | 'unchanged' | 'unmatched' | 'failed';
  error?: string;
}

export interface ReconcileReportRecord {
  scanned: number;
  recovered: number;
  unmatched: number;
  failed: number;
  outcomes: ReconcileOutcomeRecord[];
}

export interface OffRampSessionPage {
  items: OffRampSession[];
  nextCursor: string | null;
}

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
  createdBy?: string;
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

export type RoutingProviderName = 'aquarius' | 'stellarbroker';

export interface RoutingQuote {
  provider: RoutingProviderName;
  from: AssetRef;
  to: AssetRef;
  sourceAmount: string;
  destinationAmount: string;
  minDestinationAmount: string;
  slippageBps: number;
  hops: number;
  pools: string[];
  route: string[];
  alternatives?: RoutingQuote[];
}

export interface RoutingSwapRequest {
  from: string;
  to: string;
  amount: string;
}

export interface RoutingSwapResult {
  id: string;
  provider: RoutingProviderName;
  createdAt: string;
  network: StellarNetwork;
  sourceAddress: string;
  from: AssetRef;
  to: AssetRef;
  sourceAmount: string;
  estimatedDestinationAmount: string;
  minDestinationAmount: string;
  destinationAmount?: string;
  hops: number;
  pools: string[];
  txHash: string;
  txHashes?: string[];
  horizonUrl: string;
}

export interface TreasuryConversion {
  from: AssetRef;
  amount: string;
  routable: boolean;
  reason?: string;
  quote?: {
    provider: RoutingProviderName;
    destinationAmount: string;
    minDestinationAmount: string;
  };
}

export interface TreasuryRoutingPlan {
  treasury: string;
  network: StellarNetwork;
  settlementAsset: AssetRef;
  balances: { asset: AssetRef; balance: string }[];
  heldSettlementAsset: string;
  conversions: TreasuryConversion[];
  projectedSettlementAsset: string;
}

export interface TreasuryConversionTx {
  treasury: string;
  network: StellarNetwork;
  from: AssetRef;
  to: AssetRef;
  sendAmount: string;
  estimatedDestinationAmount: string;
  minDestinationAmount: string;
  path: AssetRef[];
  xdr: string;
  hash: string;
  expiresAt: string;
  signaturesRequired: number;
}

export interface OffRampQuoteFee {
  label: string;
  amount: string;
}

export interface OffRampQuote {
  provider: 'ramp' | 'carret';
  live: boolean;
  quoteId?: string;
  asset: string;
  fiatCurrency: string;
  amount: string;
  grossFiatAmount: string;
  fiatAmount: string;
  rate: string;
  fees: OffRampQuoteFee[];
}

export interface RewardBalance {
  asset: AssetRef;
  balance: string;
}

export interface RewardPayout {
  id: string;
  cursor: string;
  createdAt: string;
  amount: string;
  asset: AssetRef;
  from: string;
  txHash: string;
  explorerUrl: string;
}

export interface RewardsResponse {
  address: string | null;
  balances: RewardBalance[];
  items: RewardPayout[];
  nextCursor: string | null;
}

export type PushPlatform = 'ios' | 'android';

export interface RegisterPushDeviceRequest {
  token: string;
  platform: PushPlatform;
}

export interface StatusCheck {
  name: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface StatusReport {
  ok: boolean;
  network: StellarNetwork;
  checkedAt: string;
  checks: StatusCheck[];
}

export interface StatusAlert {
  key: string;
  severity: 'critical' | 'warning' | 'resolved';
  title: string;
  detail?: string;
  at: string;
  delivery: 'sent' | 'deduped' | 'disabled' | 'failed';
}

export interface OpsStatusResponse {
  version: string;
  startedAt: string;
  monitor: { intervalMs: number; report: StatusReport | null };
  alerting: { webhookConfigured: boolean; dedupeWindowMinutes: number };
  alerts: StatusAlert[];
}
