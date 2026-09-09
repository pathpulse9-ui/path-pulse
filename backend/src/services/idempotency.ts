import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

/**
 * Idempotency-Key middleware (PAT-77).
 *
 * Wraps any money-moving POST. When a client sends `Idempotency-Key: <uuid>`:
 *   1. Compute a stable request hash from method + path + body
 *   2. Look up the key in `idempotency_keys`
 *      - Hit + same request_hash → return cached response, don't re-execute
 *      - Hit + different hash → 409 IdempotencyConflict (client replayed with
 *        different body under the same key — a bug on their side)
 *      - Miss → let the handler run; capture the response and store it
 *
 * Cache TTL is 24h (enforced by a scheduled sweep, not a per-row expiry).
 *
 * With DATABASE_URL unset (local dev) the middleware becomes a no-op — every
 * request runs uncached. Fine for dev; production always has a DB.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

function hashRequest(req: Request): string {
  const body = req.body ? JSON.stringify(req.body) : '';
  return createHash('sha256').update(`${req.method}\n${req.path}\n${body}`).digest('hex');
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key) return next();
    if (!env.databaseUrl) return next();

    const requestHash = hashRequest(req);

    try {
      const hit = await db().query(
        'select request_hash, status_code, response_json from idempotency_keys where key = $1',
        [key],
      );
      if (hit.rows.length > 0) {
        const row = hit.rows[0];
        if (row.request_hash !== requestHash) {
          res.status(409).json({
            error: 'IdempotencyConflict',
            message: 'This idempotency key was previously used with a different request body.',
          });
          return;
        }
        res.status(row.status_code).json(row.response_json);
        return;
      }
    } catch (e) {
      logger.warn({ err: e, key }, 'idempotency lookup failed, proceeding uncached');
      return next();
    }

    // Miss — capture the outgoing response.
    const origJson = res.json.bind(res);
    let captured = false;
    res.json = ((body: unknown) => {
      if (captured) return res;
      captured = true;
      const status = res.statusCode || 200;
      // Fire-and-forget insert. Best-effort caching — if this fails we still
      // send the response, we just won't dedupe a replay.
      db()
        .query(
          `insert into idempotency_keys (key, request_hash, status_code, response_json)
           values ($1, $2, $3, $4)
           on conflict (key) do nothing`,
          [key, requestHash, status, JSON.stringify(body)],
        )
        .catch((e) => logger.warn({ err: e, key }, 'idempotency insert failed'));
      return origJson(body);
    }) as typeof res.json;

    next();
  };
}

/** Sweep expired keys — called from a lightweight interval on backend boot. */
export async function sweepExpiredKeys(): Promise<void> {
  if (!env.databaseUrl) return;
  await db().query(
    "delete from idempotency_keys where created_at < now() - interval '24 hours'",
  );
}
