import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { db } from '../db/client.js';

export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const seen = new Map<string, number>();

export async function isReplay(source: string, rawBody: string, now = Date.now()): Promise<boolean> {
  const hash = createHash('sha256').update(`${source}\n${rawBody}`).digest('hex');
  if (env.databaseUrl) {
    await db().query("delete from webhook_receipts where received_at < now() - interval '1 day'");
    const res = await db().query(
      'insert into webhook_receipts (hash) values ($1) on conflict (hash) do nothing returning hash',
      [hash],
    );
    return res.rowCount === 0;
  }
  for (const [h, at] of seen) if (now - at > REPLAY_WINDOW_MS) seen.delete(h);
  if (seen.has(hash)) return true;
  seen.set(hash, now);
  return false;
}
