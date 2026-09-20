import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  AuthRequiredFlag,
  AuthRevocableFlag,
  AuthClawbackEnabledFlag,
  type AuthFlag,
} from '@stellar/stellar-sdk';
import { SCOUT_MULTIPLIER, type ScoutTier, type ScoutAssignment, type ScoutRevocation } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon, fundWithFriendbot, accountExists } from './network.js';
import { provisionManagedWallet, getManagedWallet, getManagedSigner } from './managed.js';
import { resolveScore } from '../services/pulsegen.js';
import { logger } from '../config/logger.js';
import { recordAssignment } from '../services/scoreStore.js';

/**
 * SCOUT reputation assets (D6).
 *
 * SCOUT tiers are Classic Assets (SCOUT1/2/3) issued by a protocol issuer whose flags are
 * AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED — so the issuer controls who may
 * hold a badge and can revoke/claw it back when a driver's reputation changes. A driver
 * holds exactly one SCOUTn badge; the settlement engine reads it on-chain for the multiplier
 * (1.0 / 1.2 / 1.5x). Tier is assigned from PulseGen validation scores (synthetic until the
 * live feed lands). Testnet only; the issuer is a dev-tier account (mainnet uses a governed key).
 */

const TIER_CODE: Record<ScoutTier, string> = { 1: 'SCOUT1', 2: 'SCOUT2', 3: 'SCOUT3' };
const SCOUT_ISSUER_USER = '__scout_issuer__';
// Combined auth-flag bitmask. The SDK accepts the OR'd value at runtime; the type
// is a single-flag union, so cast the bitmask through unknown.
const AUTH_FLAGS = (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as unknown as AuthFlag;

let issuerAddress: string | null = null;

/** Provision + fund the SCOUT issuer and set its auth flags (once). */
export async function ensureIssuer(): Promise<string> {
  if (issuerAddress) return issuerAddress;
  const wallet = await provisionManagedWallet(SCOUT_ISSUER_USER);
  const issuer = wallet.address;
  const acct = await horizon.loadAccount(issuer);
  const f = acct.flags;
  if (!(f.auth_required && f.auth_revocable && f.auth_clawback_enabled)) {
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
      .addOperation(Operation.setOptions({ setFlags: AUTH_FLAGS }))
      .setTimeout(120)
      .build();
    await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(tx);
    await horizon.submitTransaction(tx);
    logger.info({ issuer, flags: AUTH_FLAGS }, 'SCOUT issuer flags set');
  }
  issuerAddress = issuer;
  return issuer;
}

/** PulseGen validation score (0..1) → SCOUT tier. Synthetic until the live feed lands. */
export function scoreToTier(score: number): ScoutTier {
  if (score >= 0.8) return 3;
  if (score >= 0.5) return 2;
  return 1;
}

function assetFor(issuer: string, tier: ScoutTier): Asset {
  return new Asset(TIER_CODE[tier], issuer);
}

interface CreditBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

/** Read a driver's current on-chain SCOUT tier (highest badge held), or null. */
export async function getOnchainTier(address: string): Promise<{ tier: ScoutTier | null; multiplier: number }> {
  const issuer = await ensureIssuer();
  if (!(await accountExists(address))) return { tier: null, multiplier: 1 };
  const acct = await horizon.loadAccount(address);
  for (const tier of [3, 2, 1] as ScoutTier[]) {
    const held = (acct.balances as CreditBalance[]).some(
      (b) =>
        b.asset_type !== 'native' &&
        b.asset_code === TIER_CODE[tier] &&
        b.asset_issuer === issuer &&
        Number(b.balance) > 0,
    );
    if (held) return { tier, multiplier: SCOUT_MULTIPLIER[tier] };
  }
  return { tier: null, multiplier: 1 };
}

/**
 * Assign the tier an existing driver's validation score maps to.
 *
 * The score is read from the active score provider for that driver id — it is
 * never supplied by the caller, so an operator cannot hand-pick a tier. The
 * driver must already exist as a PathPulse managed wallet; the badge is granted
 * to the account they are already paid into, not to a fresh keypair.
 *
 * Flow: driver `changeTrust` (managed-signed, skipped when the trustline is
 * already open) → issuer `setTrustLineFlags authorize` + `payment 1 SCOUTn`
 * (one issuer-signed tx). A badge from a lower tier is revoked first, so a
 * driver never holds two.
 */
export async function assignTierForDriver(driverId: string): Promise<ScoutAssignment> {
  const wallet = await getManagedWallet(driverId);
  if (!wallet) {
    throw new Error(
      `driver ${driverId} has no managed wallet — assign a tier only to a driver that already exists`,
    );
  }
  const address = wallet.address;

  const validation = await resolveScore(driverId);
  const tier = scoreToTier(validation.score);

  const issuer = await ensureIssuer();
  const asset = assetFor(issuer, tier);

  const existing = await getOnchainTier(address);
  if (existing.tier === tier) {
    throw new Error(`driver ${driverId} already holds ${TIER_CODE[tier]}`);
  }
  if (existing.tier) await revokeTier(address);

  const driverAcct = await horizon.loadAccount(address);
  const hasTrustline = (driverAcct.balances as CreditBalance[]).some(
    (b) => b.asset_code === TIER_CODE[tier] && b.asset_issuer === issuer,
  );
  if (!hasTrustline) {
    const trustTx = new TransactionBuilder(driverAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(120)
      .build();
    await (await getManagedSigner(driverId)).sign(trustTx);
    await horizon.submitTransaction(trustTx);
  }

  const issuerAcct = await horizon.loadAccount(issuer);
  const grantTx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.setTrustLineFlags({ trustor: address, asset, flags: { authorized: true } }))
    .addOperation(Operation.payment({ destination: address, asset, amount: '1' }))
    .setTimeout(120)
    .build();
  await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(grantTx);
  const res = await horizon.submitTransaction(grantTx);

  logger.info(
    { driverId, address, tier, score: validation.score, source: validation.source, txHash: res.hash },
    'SCOUT tier assigned from validation score',
  );

  await recordAssignment({
    driverId,
    address,
    tier,
    multiplier: SCOUT_MULTIPLIER[tier],
    score: validation.score,
    scoreSource: validation.source,
    scoreImportId: validation.importId,
    assetCode: TIER_CODE[tier],
    issuer,
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
    createdAt: new Date().toISOString(),
  });

  return {
    userId: driverId,
    address,
    tier,
    multiplier: SCOUT_MULTIPLIER[tier],
    score: validation.score,
    scoredAt: validation.scoredAt,
    scoreSource: validation.source,
    scoreImportId: validation.importId ?? undefined,
    issuer,
    assetCode: TIER_CODE[tier],
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
  };
}

/**
 * Revoke a driver's badge: claw back the asset and de-authorize the trustline,
 * in one issuer-signed transaction. AUTH_CLAWBACK_ENABLED makes the seizure
 * possible without the holder's signature; AUTH_REVOCABLE makes the
 * de-authorization stick, so the driver cannot re-acquire the badge by holding
 * the trustline open. After this the settlement engine reads no badge and the
 * driver falls back to the 1.0x multiplier.
 */
export async function revokeTier(address: string): Promise<ScoutRevocation> {
  const issuer = await ensureIssuer();
  const { tier } = await getOnchainTier(address);
  if (!tier) throw new Error(`${address} holds no SCOUT badge to revoke`);

  const asset = assetFor(issuer, tier);
  const driverAcct = await horizon.loadAccount(address);
  const held = (driverAcct.balances as CreditBalance[]).find(
    (b) => b.asset_code === TIER_CODE[tier] && b.asset_issuer === issuer,
  );
  const amount = held?.balance ?? '0';

  const issuerAcct = await horizon.loadAccount(issuer);
  const builder = new TransactionBuilder(issuerAcct, {
    fee: BASE_FEE,
    networkPassphrase: env.networkPassphrase,
  });
  if (Number(amount) > 0) {
    builder.addOperation(Operation.clawback({ from: address, asset, amount }));
  }
  builder.addOperation(
    Operation.setTrustLineFlags({ trustor: address, asset, flags: { authorized: false } }),
  );
  const tx = builder.setTimeout(120).build();

  await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(tx);
  const res = await horizon.submitTransaction(tx);
  logger.info({ address, tier, amount }, 'SCOUT tier revoked');

  return {
    address,
    revokedTier: tier,
    assetCode: TIER_CODE[tier],
    issuer,
    clawedBackAmount: amount,
    txHash: res.hash,
    horizonUrl: horizonTxUrl(res.hash),
  };
}

export async function getScoutConfig() {
  const issuer = await ensureIssuer();
  return {
    issuer,
    network: env.network,
    tiers: ([1, 2, 3] as ScoutTier[]).map((tier) => ({
      tier,
      code: TIER_CODE[tier],
      multiplier: SCOUT_MULTIPLIER[tier],
    })),
  };
}
