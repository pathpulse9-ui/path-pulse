import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { db } from '../db/client.js';

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const usedSteps = new Map<string, number>();

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('TOTP secret is not base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export function matchingStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const expected = Buffer.from(totpAt(secret, current + delta));
    if (timingSafeEqual(expected, Buffer.from(code))) return current + delta;
  }
  return null;
}

async function claimStep(identity: string, step: number): Promise<boolean> {
  if (!env.databaseUrl) {
    if ((usedSteps.get(identity) ?? -1) >= step) return false;
    usedSteps.set(identity, step);
    return true;
  }
  const r = await db().query(
    `insert into ops_totp_steps (identity, last_step) values ($1, $2)
     on conflict (identity) do update set last_step = excluded.last_step
       where ops_totp_steps.last_step < excluded.last_step
     returning identity`,
    [identity, step],
  );
  return (r.rowCount ?? 0) > 0;
}

export function totpRequired(identity: string): boolean {
  return env.network === 'mainnet' || env.opsTotpSecrets.has(identity);
}

export async function verifyOperatorTotp(identity: string, code: unknown, now = Date.now()): Promise<boolean> {
  const secret = env.opsTotpSecrets.get(identity);
  if (!secret || typeof code !== 'string') return false;
  const step = matchingStep(secret, code, now);
  if (step === null) return false;
  return claimStep(identity, step);
}
