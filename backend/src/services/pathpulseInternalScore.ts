import type { ScoreProvider } from './pulsegen.js';
import type { ValidationScore } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Internal driver-signal scorer — v1 PathPulse-native validation score.
 *
 * No external feed exists yet, and the derived fallback (SHA-256 of the
 * driver id) is a deterministic noise generator — it looks like a score
 * but measures nothing. This provider actually measures observable signals
 * PathPulse already captures:
 *
 *   1. KYC verified via Carret                     weight 0.25
 *   2. Verified bank attached                       weight 0.20
 *   3. Settlement-batch participation count         weight 0.20
 *   4. Off-ramp activity (completed withdrawals)    weight 0.15
 *   5. Managed-wallet account age                   weight 0.10
 *   6. Payout success rate (success / attempts)     weight 0.10
 *
 * Each signal normalises into 0..1, we take a weighted sum, then clamp.
 * The weights are intentionally small on activity + age so a brand-new
 * verified driver scores around 0.45 (SCOUT1 territory, 1.0x multiplier)
 * and climbs to SCOUT2/3 only after repeated honest participation.
 *
 * The whole calculation is deterministic + traceable: given the same DB
 * rows, two different reviewers must compute the same score. That is
 * what makes it defensible when the SCOUT tier it issues decides how a
 * driver's reward is multiplied.
 */

const WEIGHTS = {
  kycVerified: 0.25,
  bankVerified: 0.20,
  settlementCount: 0.20,
  offRampCount: 0.15,
  accountAgeDays: 0.10,
  payoutSuccess: 0.10,
};

// Saturation points — the signal values at which that component reaches 1.0.
const SATURATE = {
  settlementCount: 20,  // 20+ settlement batches → full credit
  offRampCount: 10,     // 10+ completed off-ramps → full credit
  accountAgeDays: 180,  // 6-month-old account → full credit
};

export interface InternalScoreBreakdown {
  kycVerified: number;
  bankVerified: number;
  settlementCount: number;
  offRampCount: number;
  accountAgeDays: number;
  payoutSuccess: number;
  total: number;
}

export async function computeInternalScore(driverId: string): Promise<InternalScoreBreakdown> {
  if (!env.databaseUrl) {
    throw new Error('PATHPULSE_INTERNAL_SCORER requires DATABASE_URL');
  }
  const pool = db();

  // 1. KYC verified via Carret.
  const kycRow = await pool.query<{ kyc_status: string }>(
    `select kyc_status from carret_subaccounts where user_id = $1 limit 1`,
    [driverId],
  ).catch(() => ({ rows: [] as { kyc_status: string }[] }));
  const kycVerified = kycRow.rows[0]?.kyc_status === 'verified' ? 1 : 0;

  // 2. Verified bank attached. Carret stores banks remotely; we proxy that
  // state at session time, so our best DB proxy is: did the user *finish*
  // an off-ramp session, which requires a verified bank? If any off-ramp
  // session reached completed/pending_anchor, treat the bank as verified.
  // Falls through to 0 for new drivers with no sessions yet.
  const bankRow = await pool.query<{ ever_passed_bank: boolean }>(
    `select exists(
       select 1 from off_ramp_sessions
       where user_id = $1 and status in ('pending_anchor', 'completed')
     ) as ever_passed_bank`,
    [driverId],
  ).catch(() => ({ rows: [{ ever_passed_bank: false }] }));
  const bankVerified = bankRow.rows[0]?.ever_passed_bank ? 1 : 0;

  // 3. Settlement-batch participation. driver_payouts is a jsonb array of
  // {address, amount, tier, ...} per batch. We can't key on userId directly
  // (settlement writes stellar addresses, not userIds), so cross-reference
  // the user's managed-wallet public key.
  const wallet = await pool.query<{ public_key: string }>(
    `select public_key from managed_wallets where user_id = $1 limit 1`,
    [driverId],
  ).catch(() => ({ rows: [] as { public_key: string }[] }));
  let settlementCount = 0;
  if (wallet.rows[0]?.public_key) {
    const r = await pool.query<{ c: string }>(
      `select count(*)::text as c from settlement_batches
        where driver_payouts @> $1::jsonb`,
      [JSON.stringify([{ address: wallet.rows[0].public_key }])],
    ).catch(() => ({ rows: [{ c: '0' }] }));
    settlementCount = Number(r.rows[0]?.c ?? 0);
  }

  // 4. Off-ramp activity — completed withdrawals demonstrate real demand +
  // willingness to use the rail. Any status in a terminal success state.
  const offRamp = await pool.query<{ c: string }>(
    `select count(*)::text as c from off_ramp_sessions
      where user_id = $1 and status = 'completed'`,
    [driverId],
  ).catch(() => ({ rows: [{ c: '0' }] }));
  const offRampCount = Number(offRamp.rows[0]?.c ?? 0);

  // 5. Account age — proxy via managed_wallets.created_at.
  const age = await pool.query<{ age_days: string }>(
    `select coalesce(extract(epoch from (now() - created_at)) / 86400, 0)::text as age_days
       from managed_wallets where user_id = $1 limit 1`,
    [driverId],
  ).catch(() => ({ rows: [] as { age_days: string }[] }));
  const accountAgeDays = Number(age.rows[0]?.age_days ?? 0);

  // 6. Payout success rate. payout_attempts has rows for every attempt;
  // outcome = 'success' means it landed. If there are zero attempts the
  // signal is "not yet observed" — treat as neutral 0.5 so a brand-new
  // driver isn't penalised for the absence.
  const payouts = await pool.query<{ total: string; wins: string }>(
    `select count(*)::text as total,
            count(*) filter (where outcome = 'success')::text as wins
       from payout_attempts
      where disbursement_id in (
        select disbursement_id from payout_batches
         where disbursement_id is not null
      )`,
  ).catch(() => ({ rows: [{ total: '0', wins: '0' }] }));
  const total = Number(payouts.rows[0]?.total ?? 0);
  const wins = Number(payouts.rows[0]?.wins ?? 0);
  // Note: this is a platform-wide proxy rather than per-driver because
  // payout_attempts does not store a driverId column. Still: a platform
  // with 90%+ attempt success is a healthier network signal than one
  // bouncing payouts, so it's a useful floor.
  const payoutSuccess = total > 0 ? wins / total : 0.5;

  // Normalise each signal into 0..1 with the saturation points.
  const sSettlement = Math.min(1, settlementCount / SATURATE.settlementCount);
  const sOffRamp    = Math.min(1, offRampCount / SATURATE.offRampCount);
  const sAge        = Math.min(1, accountAgeDays / SATURATE.accountAgeDays);

  const total01 =
    WEIGHTS.kycVerified     * kycVerified +
    WEIGHTS.bankVerified    * bankVerified +
    WEIGHTS.settlementCount * sSettlement +
    WEIGHTS.offRampCount    * sOffRamp +
    WEIGHTS.accountAgeDays  * sAge +
    WEIGHTS.payoutSuccess   * payoutSuccess;

  return {
    kycVerified,
    bankVerified,
    settlementCount: sSettlement,
    offRampCount: sOffRamp,
    accountAgeDays: sAge,
    payoutSuccess,
    total: Math.min(1, Math.max(0, total01)),
  };
}

export const pathpulseInternalScoreProvider: ScoreProvider = {
  name: 'pathpulse-internal',
  live: true,

  async getScore(driverId): Promise<ValidationScore> {
    const breakdown = await computeInternalScore(driverId);
    logger.debug({ driverId, breakdown }, 'internal score computed');
    return {
      driverId,
      score: breakdown.total,
      scoredAt: new Date().toISOString(),
      source: 'pathpulse-internal',
    };
  },
};
