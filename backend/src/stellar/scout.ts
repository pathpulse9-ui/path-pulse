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
import { horizon, fundWithFriendbot, accountExists, submitToHorizon } from './network.js';
import { provisionManagedWallet, getManagedWallet, getManagedSigner, getReserveSponsor } from './managed.js';
import { addSponsoredTrustline } from './sponsorship.js';
import { resolveScore } from '../services/pulsegen.js';
import { logger } from '../config/logger.js';
import { recordAssignment } from '../services/scoreStore.js';

const TIER_CODE: Record<ScoutTier, string> = { 1: 'SCOUT1', 2: 'SCOUT2', 3: 'SCOUT3' };
const SCOUT_ISSUER_USER = '__scout_issuer__';
const AUTH_FLAGS = (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as unknown as AuthFlag;

let issuerAddress: string | null = null;

export async function ensureIssuer(): Promise<string> {
  if (issuerAddress) return issuerAddress;
  const wallet = await provisionManagedWallet(SCOUT_ISSUER_USER);
  const issuer = wallet.address;
  const acct = await horizon.loadAccount(issuer);
  const f = acct.flags;
  const needsFlags = !(f.auth_required && f.auth_revocable && f.auth_clawback_enabled);
  const homeDomain = env.sep10.homeDomain;
  const needsDomain = (acct as { home_domain?: string }).home_domain !== homeDomain;
  if (needsFlags || needsDomain) {
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
      .addOperation(
        Operation.setOptions({ ...(needsFlags ? { setFlags: AUTH_FLAGS } : {}), ...(needsDomain ? { homeDomain } : {}) }),
      )
      .setTimeout(120)
      .build();
    await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(tx);
    await submitToHorizon(tx, 'SCOUT issuer setup');
    logger.info({ issuer, flags: AUTH_FLAGS, homeDomain }, 'SCOUT issuer flags and home domain set');
  }
  issuerAddress = issuer;
  return issuer;
}

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
  if (!hasTrustline && env.accountFunding === 'sponsor') {
    await addSponsoredTrustline(await getReserveSponsor(), await getManagedSigner(driverId), asset);
  } else if (!hasTrustline) {
    const trustTx = new TransactionBuilder(driverAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(120)
      .build();
    await (await getManagedSigner(driverId)).sign(trustTx);
    await submitToHorizon(trustTx, 'SCOUT driver trustline');
  }

  const issuerAcct = await horizon.loadAccount(issuer);
  const grantTx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: env.networkPassphrase })
    .addOperation(Operation.setTrustLineFlags({ trustor: address, asset, flags: { authorized: true } }))
    .addOperation(Operation.payment({ destination: address, asset, amount: '1' }))
    .setTimeout(120)
    .build();
  await (await getManagedSigner(SCOUT_ISSUER_USER)).sign(grantTx);
  const res = await submitToHorizon(grantTx, 'SCOUT badge grant');

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
  const res = await submitToHorizon(tx, 'SCOUT badge revocation');
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

export function scoutCurrencyToml(issuer: string): string[] {
  return ([1, 2, 3] as ScoutTier[]).flatMap((tier) => [
    '',
    '[[CURRENCIES]]',
    `code="${TIER_CODE[tier]}"`,
    `issuer="${issuer}"`,
    'display_decimals=0',
    `name="PathPulse SCOUT tier ${tier}"`,
    `desc="PathPulse driver reputation badge, tier ${tier}. Holding it applies a ${SCOUT_MULTIPLIER[tier].toFixed(1)}x reward multiplier. Issued and revocable by PathPulse only; not transferable or redeemable."`,
    'is_asset_anchored=false',
    'status="live"',
  ]);
}

export async function scoutIssuerAddress(): Promise<string | null> {
  try {
    return (await getManagedWallet(SCOUT_ISSUER_USER))?.address ?? null;
  } catch {
    return null;
  }
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
