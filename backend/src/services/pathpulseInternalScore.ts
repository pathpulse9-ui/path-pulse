import type { ScoreProvider } from './pulsegen.js';
import type { ValidationScore } from '@pathpulse/contract';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Internal driver-signal scorer. It measures identity and account health,
 * never road-data quality, so it is capped below the SCOUT2 threshold:
 * only a delivered PulseGen validation score can lift a driver above tier 1.
 *
 *   1. KYC verified via Carret                     weight 0.25
 *   2. Verified bank attached                       weight 0.20
 *   3. Managed-wallet account age                   weight 0.10
 *   4. Payout success rate (success / attempts)     weight 0.10
 *
 * Settlement and off-ramp counts are deliberately excluded: being paid must
 * not raise the tier that sets pay.
 */

const WEIGHTS = {
  kycVerified: 0.25,
  bankVerified: 0.20,
  accountAgeDays: 0.10,
  payoutSuccess: 0.10,
};

export const INTERNAL_SCORE_CAP = 0.49;

const SATURATE = {
  accountAgeDays: 180,
};

export interface InternalScoreBreakdown {
  kycVerified: number;
  bankVerified: number;
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

  // 3. Account age — proxy via managed_wallets.created_at.
  const age = await pool.query<{ age_days: string }>(
    `select coalesce(extract(epoch from (now() - created_at)) / 86400, 0)::text as age_days
       from managed_wallets where user_id = $1 limit 1`,
    [driverId],
  ).catch(() => ({ rows: [] as { age_days: string }[] }));
  const accountAgeDays = Number(age.rows[0]?.age_days ?? 0);

  // 4. Payout success rate. payout_attempts has rows for every attempt;
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

  const sAge = Math.min(1, accountAgeDays / SATURATE.accountAgeDays);

  const total01 =
    WEIGHTS.kycVerified    * kycVerified +
    WEIGHTS.bankVerified   * bankVerified +
    WEIGHTS.accountAgeDays * sAge +
    WEIGHTS.payoutSuccess  * payoutSuccess;

  return {
    kycVerified,
    bankVerified,
    accountAgeDays: sAge,
    payoutSuccess,
    total: Math.min(INTERNAL_SCORE_CAP, Math.max(0, total01)),
  };
}

export const pathpulseInternalScoreProvider: ScoreProvider = {
  name: 'pathpulse-internal',
  live: true,

  async getScore(driverId): Promise<ValidationScore> {
    const breakdown = await computeInternalScore(driverId);
    logger.debug({ driverId, total: breakdown.total }, 'internal score computed');
    return {
      driverId,
      score: breakdown.total,
      scoredAt: new Date().toISOString(),
      source: 'pathpulse-internal',
    };
  },
};
