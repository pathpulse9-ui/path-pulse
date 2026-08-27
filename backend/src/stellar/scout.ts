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
import { SCOUT_MULTIPLIER, type ScoutTier, type ScoutAssignment } from '@pathpulse/contract';
import { env, horizonTxUrl } from '../config/env.js';
import { horizon, fundWithFriendbot, accountExists } from './network.js';
import { provisionManagedWallet, getManagedSigner } from './managed.js';
import { logger } from '../config/logger.js';

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
 * Demo assignment: provision a backend-controlled driver, then grant the tier its score maps to.
 * Flow: driver `changeTrust` (driver-signed) → issuer `setTrustLineFlags authorize` + `payment 1 SCOUTn`
 * (issuer-signed). The driver address can then be paid by the settlement engine.
 */
export async function assignSampleTier(score: number): Promise<ScoutAssignment> {
  const issuer = await ensureIssuer();
  const tier = scoreToTier(score);
  const asset = assetFor(issuer, tier);

  const driver = Keypair.random();
  await fundWithFriendbot(driver.publicKey());

  // 1. Driver establishes the trustline (their signature).
  const driverAcct = await horizon.loadAccount(driver.publicKey());
  const trustTx = new TransactionBuilder(driverAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  trustTx.sign(driver);
  await horizon.submitTransaction(trustTx);

  // 2+3. Issuer authorizes the trustline and sends the badge (one issuer-signed tx).
  const issuerAcct = await horizon.loadAccount(issuer);
  const grantTx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.setTrustLineFlags({ trustor: driver.publicKey(), asset, flags: { authorized: true } }))
    .addOperation(Operation.payment({ destination: driver.publicKey(), asset, amount: '1' }))
    .setTimeout(120)
    .build();
  await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(grantTx);
  const res = await horizon.submitTransaction(grantTx);

  return {
    userId: `scout-${driver.publicKey().slice(0, 8)}`,
    address: driver.publicKey(),
    tier,
    multiplier: SCOUT_MULTIPLIER[tier],
    score,
    issuer,
    assetCode: TIER_CODE[tier],
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
