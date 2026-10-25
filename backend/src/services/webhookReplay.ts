import { createHash } from 'node:crypto';
import { env, isMainnet } from '../config/env.js';
import { db } from '../db/client.js';

export const REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const MAX_SEEN = 10_000;
const seen = new Map<string, number>();
let lastSweep = 0;

export async function isReplay(source: string, rawBody: string, now = Date.now()): Promise<boolean> {
  const hash = createHash('sha256').update(`${source}\n${rawBody}`).digest('hex');
  if (env.databaseUrl) {
    if (now - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = now;
      await db().query("delete from webhook_receipts where received_at < now() - interval '7 days'");
    }
    const res = await db().query(
      'insert into webhook_receipts (hash) values ($1) on conflict (hash) do nothing returning hash',
      [hash],
    );
    return res.rowCount === 0;
  }
  if (isMainnet) throw new Error('webhook replay protection requires the database on mainnet');
  for (const [h, at] of seen) if (now - at > REPLAY_WINDOW_MS) seen.delete(h);
  if (seen.has(hash)) return true;
  if (seen.size >= MAX_SEEN) seen.delete(seen.keys().next().value as string);
  seen.set(hash, now);
  return false;
}
