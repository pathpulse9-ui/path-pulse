import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { numEnv } from '../config/env.js';
import { getSessionFromRequest } from '../services/session.js';
import { parsePartnerKey } from '../services/partnerKeys.js';

const shared: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RateLimited', message: 'Too many requests — slow down and retry shortly.' },
};

export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: numEnv('AUTH_RATE_LIMIT', 20, 1),
});

export const writeLimiter = rateLimit({
  ...shared,
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
  windowMs: 60 * 1000,
  limit: 300,
  skip: (req: Request) => !parsePartnerKey(req.headers.authorization),
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
});

export const verifiedPartnerKeyLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req: Request) => (req as Request & { partnerKeyId?: string }).partnerKeyId ?? ipKeyGenerator(req.ip ?? ''),
});

export const callbackLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 120,
});

export const SPONSORED_TX_LIMIT_PER_HOUR = 30;

export const sponsoredTxLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: SPONSORED_TX_LIMIT_PER_HOUR,
  keyGenerator: (req: Request) => getSessionFromRequest(req)?.userId ?? ipKeyGenerator(req.ip ?? ''),
});
