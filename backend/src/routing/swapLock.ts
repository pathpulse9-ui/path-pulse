import { env } from '../config/env.js';
import { db } from '../db/client.js';

export const SWAP_LOCK_KEY = 7_411_902_001;

let tail: Promise<unknown> = Promise.resolve();

async function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!env.databaseUrl) return fn();
  const client = await db().connect();
  try {
    await client.query('select pg_advisory_lock($1)', [SWAP_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [SWAP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export function withSwapLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(() => withDbLock(fn));
  tail = run.catch(() => undefined);
  return run;
}
