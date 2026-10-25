import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';
import { getSessionFromRequest } from './session.js';

const MAX_KEY_LENGTH = 255;

function hashRequest(req: Request): string {
  const body = req.body ? JSON.stringify(req.body) : '';
  return createHash('sha256').update(`${req.method}\n${req.path}\n${body}`).digest('hex');
}

function reject(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key) {
      reject(res, 400, 'IdempotencyKeyRequired', 'This endpoint moves value and requires an Idempotency-Key header.');
      return;
    }
    if (key.length > MAX_KEY_LENGTH) {
      reject(res, 400, 'IdempotencyKeyInvalid', `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters.`);
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session) {
      reject(res, 401, 'Unauthorized', 'session required');
      return;
    }
    if (!env.databaseUrl) {
      reject(res, 503, 'IdempotencyUnavailable', 'Idempotency storage is not configured. Nothing was executed.');
      return;
    }

    const userId = session.userId;
    const requestHash = hashRequest(req);

    try {
      const claimed = await db().query(
        `insert into idempotency_requests (user_id, key, request_hash)
         values ($1, $2, $3)
         on conflict (user_id, key) do nothing
         returning key`,
        [userId, key, requestHash],
      );

      if (claimed.rowCount === 0) {
        const existing = await db().query(
          `select request_hash, status_code, response_json, completed_at
           from idempotency_requests where user_id = $1 and key = $2`,
          [userId, key],
        );
        const row = existing.rows[0];
        if (!row) {
          reject(res, 409, 'IdempotencyInProgress', 'A request with this Idempotency-Key is being processed. Retry shortly.');
          return;
        }
        if (row.request_hash !== requestHash) {
          reject(res, 409, 'IdempotencyConflict', 'This Idempotency-Key was already used with a different request.');
          return;
        }
        if (!row.completed_at) {
          reject(res, 409, 'IdempotencyInProgress', 'A request with this Idempotency-Key is being processed. Retry shortly.');
          return;
        }
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(row.status_code).json(row.response_json);
        return;
      }
    } catch (e) {
      logger.error({ err: e, userId, key }, 'idempotency claim failed');
      reject(res, 503, 'IdempotencyUnavailable', 'Could not reserve the Idempotency-Key. Nothing was executed; retry with the same key.');
      return;
    }

    const store = (statusCode: number, body: unknown) => {
      const keep = statusCode < 400 || (res.locals as { keepIdempotencyKey?: boolean }).keepIdempotencyKey === true;
      const query = keep
        ? db().query(
            `update idempotency_requests
             set status_code = $3, response_json = $4, completed_at = now()
             where user_id = $1 and key = $2`,
            [userId, key, statusCode, JSON.stringify(body ?? null)],
          )
        : db().query('delete from idempotency_requests where user_id = $1 and key = $2', [userId, key]);
      query.catch((e) => logger.error({ err: e, userId, key }, 'idempotency result store failed'));
    };

    const origJson = res.json.bind(res);
    let captured = false;
    res.json = ((body: unknown) => {
      if (captured) return origJson(body);
      captured = true;
      store(res.statusCode || 200, body);
      return origJson(body);
    }) as typeof res.json;
    res.on('finish', () => {
      if (captured) return;
      captured = true;
      store(res.statusCode || 200, null);
    });

    next();
  };
}

export async function sweepExpiredKeys(): Promise<void> {
  if (!env.databaseUrl) return;
  await db().query(
    "delete from idempotency_requests where completed_at is not null and created_at < now() - interval '24 hours'",
  );
}
