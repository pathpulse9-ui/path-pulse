import rateLimit, { ipKeyGenerator, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import type { Request } from 'express';
import { env, numEnv } from '../config/env.js';
import { db } from '../db/client.js';
import { getSessionFromRequest } from '../services/session.js';
import { parsePartnerKey } from '../services/partnerKeys.js';

export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const r = await db().query<{ hits: number; reset_at: Date }>(
      `insert into rate_limit_hits (key, hits, reset_at)
       values ($1, 1, now() + ($2 || ' milliseconds')::interval)
       on conflict (key) do update set
         hits = case when rate_limit_hits.reset_at <= now() then 1 else rate_limit_hits.hits + 1 end,
         reset_at = case when rate_limit_hits.reset_at <= now() then excluded.reset_at else rate_limit_hits.reset_at end
       returning hits, reset_at`,
      [this.prefix + key, String(this.windowMs)],
    );
    return { totalHits: r.rows[0].hits, resetTime: r.rows[0].reset_at };
  }

  async decrement(key: string): Promise<void> {
    await db().query('update rate_limit_hits set hits = greatest(hits - 1, 0) where key = $1', [this.prefix + key]);
  }

  async resetKey(key: string): Promise<void> {
    await db().query('delete from rate_limit_hits where key = $1', [this.prefix + key]);
  }
}

export async function sweepRateLimits(): Promise<void> {
  if (!env.databaseUrl) return;
  await db().query("delete from rate_limit_hits where reset_at < now() - interval '1 hour'");
}

function store(prefix: string): Partial<Options> {
  return env.databaseUrl ? { store: new PostgresRateLimitStore(prefix) } : {};
}

const shared: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RateLimited', message: 'Too many requests — slow down and retry shortly.' },
};

export const readLimiter = rateLimit({
  ...shared,
  ...store('read'),
  windowMs: 60 * 1000,
  limit: numEnv('READ_RATE_LIMIT', 300, 1),
  skip: (req: Request) => req.method !== 'GET' && req.method !== 'HEAD',
});

export const carretLimiter = rateLimit({
  ...shared,
  ...store('carret'),
  windowMs: 60 * 1000,
  limit: numEnv('CARRET_RATE_LIMIT', 30, 1),
  keyGenerator: (req: Request) => getSessionFromRequest(req)?.userId ?? ipKeyGenerator(req.ip ?? ''),
});

export const authLimiter = rateLimit({
  ...shared,
  ...store('auth'),
  windowMs: 15 * 60 * 1000,
  limit: numEnv('AUTH_RATE_LIMIT', 20, 1),
});

export const writeLimiter = rateLimit({
  ...shared,
  ...store('write'),
  windowMs: 60 * 1000,
  limit: numEnv('WRITE_RATE_LIMIT', 60, 1),
  skip: (req: Request) =>
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.path === '/v1/offramp/callback',
});

export const partnerKeyLimiter = rateLimit({
  ...shared,
  ...store('partner-ip'),
  windowMs: 60 * 1000,
  limit: 300,
  skip: (req: Request) => !parsePartnerKey(req.headers.authorization),
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
});

export const verifiedPartnerKeyLimiter = rateLimit({
  ...shared,
  ...store('partner-key'),
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req: Request) => (req as Request & { partnerKeyId?: string }).partnerKeyId ?? ipKeyGenerator(req.ip ?? ''),
});

export const callbackLimiter = rateLimit({
  ...shared,
  ...store('callback'),
  windowMs: 60 * 1000,
  limit: 120,
});

export const SPONSORED_TX_LIMIT_PER_HOUR = 30;

export const sponsoredTxLimiter = rateLimit({
  ...shared,
  ...store('sponsored-tx'),
  windowMs: 60 * 60 * 1000,
  limit: SPONSORED_TX_LIMIT_PER_HOUR,
  keyGenerator: (req: Request) => getSessionFromRequest(req)?.userId ?? ipKeyGenerator(req.ip ?? ''),
});
