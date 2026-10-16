import { env } from '../config/env.js';
import { db } from '../db/client.js';

export type CarretActivity =
  | 'deposit_inr'
  | 'withdraw_inr'
  | 'deposit_crypto'
  | 'withdraw_crypto';

export const CARRET_DAILY_LIMIT_INR = 30000;

const memoryUsage = new Map<string, number>();

function hasDb(): boolean {
  return Boolean(env.databaseUrl);
}

function todayIst(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function usedToday(
  accountId: string,
  activity: CarretActivity,
): Promise<number> {
  const ymd = todayIst();
  if (!hasDb()) {
    return memoryUsage.get(`${accountId}|${activity}|${ymd}`) ?? 0;
  }
  const res = await db().query<{ amount_inr: string }>(
    `select amount_inr from carret_daily_usage
     where carret_account_id = $1 and activity = $2 and ymd_ist = $3`,
    [accountId, activity, ymd],
  );
  return Number(res.rows[0]?.amount_inr ?? 0);
}

export async function remainingLimit(
  accountId: string,
  activity: CarretActivity,
): Promise<number> {
  const used = await usedToday(accountId, activity);
  return Math.max(0, CARRET_DAILY_LIMIT_INR - used);
}

export async function allRemaining(accountId: string): Promise<Record<CarretActivity, number>> {
  const [a, b, c, d] = await Promise.all([
    remainingLimit(accountId, 'deposit_inr'),
    remainingLimit(accountId, 'withdraw_inr'),
    remainingLimit(accountId, 'deposit_crypto'),
    remainingLimit(accountId, 'withdraw_crypto'),
  ]);
  return {
    deposit_inr: a,
    withdraw_inr: b,
    deposit_crypto: c,
    withdraw_crypto: d,
  };
}

export async function assertUnderLimit(
  accountId: string,
  activity: CarretActivity,
  amountInr: number,
): Promise<void> {
  const used = await usedToday(accountId, activity);
  const remaining = CARRET_DAILY_LIMIT_INR - used;
  if (amountInr > remaining) {
    const e = new Error(
      `Carret daily limit exceeded for ${activity}: ` +
        `requested ₹${amountInr.toFixed(2)}, ` +
        `remaining ₹${remaining.toFixed(2)} of ₹${CARRET_DAILY_LIMIT_INR}.`,
    ) as Error & { status: number; name: string; details: unknown };
    e.status = 429;
    e.name = 'CarretDailyLimitExceeded';
    e.details = {
      activity,
      accountId,
      requestedInr: amountInr,
      remainingInr: remaining,
      dailyCapInr: CARRET_DAILY_LIMIT_INR,
      resetAt: nextIstMidnightIso(),
    };
    throw e;
  }
}

export async function recordUsage(
  accountId: string,
  activity: CarretActivity,
  amountInr: number,
): Promise<void> {
  const ymd = todayIst();
  if (!hasDb()) {
    const key = `${accountId}|${activity}|${ymd}`;
    memoryUsage.set(key, (memoryUsage.get(key) ?? 0) + amountInr);
    return;
  }
  await db().query(
    `insert into carret_daily_usage (carret_account_id, activity, ymd_ist, amount_inr)
     values ($1, $2, $3, $4)
     on conflict (carret_account_id, activity, ymd_ist)
     do update set amount_inr = carret_daily_usage.amount_inr + excluded.amount_inr,
                   updated_at = now()`,
    [accountId, activity, ymd, amountInr],
  );
}

function nextIstMidnightIso(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  nowIst.setUTCHours(24, 0, 0, 0);
  return new Date(nowIst.getTime() - IST_OFFSET_MS).toISOString();
}
