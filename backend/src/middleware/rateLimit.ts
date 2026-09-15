import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limits for mainnet readiness (D7 security review).
 *
 * Two buckets:
 *   - `authLimiter`  — the credential-testing routes only (partner passcode,
 *     Google/SEP-10 verify, guest). Without it GOV_PARTNER_PASSCODE is open to
 *     unbounded guessing. Deliberately NOT the whole /v1/auth prefix: the web
 *     app polls `/v1/auth/me` on every page load and would exhaust the budget.
 *   - `writeLimiter` — every other mutating request. Reads are exempt so the
 *     gov dashboard and indexer queries stay unthrottled.
 *
 * Counters are per-process and in-memory. That is sufficient only because
 * App Runner autoscaling is pinned to a single instance; a second instance
 * doubles every effective limit. Moving to a shared store (Redis) is a
 * prerequisite for scaling past one instance — see docs/RUNBOOK.md.
 */

const shared: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RateLimited', message: 'Too many requests — slow down and retry shortly.' },
};

export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

export const writeLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 60,
  skip: (req: Request) =>
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    // Provider webhooks are signature-verified and fail closed; throttling them
    // would strand off-ramp sessions on a legitimate burst.
    req.path === '/v1/offramp/callback',
});
