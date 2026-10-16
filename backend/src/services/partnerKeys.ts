import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db/client.js';

export interface PartnerKey {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const KEY_PATTERN = /^pp_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function parsePartnerKey(header: string | undefined): { id: string; key: string } | null {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  if (!match) return null;
  const parsed = KEY_PATTERN.exec(match[1]);
  return parsed ? { id: parsed[1], key: match[1] } : null;
}

type Row = {
  id: string;
  name: string;
  key_hash: string;
  created_by: string | null;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
};

function toKey(r: Row): PartnerKey {
  return {
    id: r.id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    revokedAt: r.revoked_at?.toISOString() ?? null,
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
  };
}

export async function createPartnerKey(name: string, createdBy: string): Promise<{ key: string; record: PartnerKey }> {
  const id = randomBytes(8).toString('hex');
  const key = `pp_${id}_${randomBytes(32).toString('base64url')}`;
  const r = await db().query<Row>(
    `insert into partner_api_keys (id, name, key_hash, created_by) values ($1, $2, $3, $4) returning *`,
    [id, name, hashKey(key), createdBy],
  );
  return { key, record: toKey(r.rows[0]) };
}

export async function listPartnerKeys(): Promise<PartnerKey[]> {
  const r = await db().query<Row>('select * from partner_api_keys order by created_at desc');
  return r.rows.map(toKey);
}

export async function revokePartnerKey(id: string): Promise<boolean> {
  const r = await db().query('update partner_api_keys set revoked_at = now() where id = $1 and revoked_at is null', [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function verifyPartnerKey(req: Request): Promise<string | null> {
  const parsed = parsePartnerKey(req.headers.authorization);
  if (!parsed) return null;
  const r = await db().query<Row>('select * from partner_api_keys where id = $1 and revoked_at is null', [parsed.id]);
  const row = r.rows[0];
  if (!row) return null;
  const expected = Buffer.from(row.key_hash, 'hex');
  const got = Buffer.from(hashKey(parsed.key), 'hex');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  void db().query('update partner_api_keys set last_used_at = now() where id = $1', [row.id]).catch(() => undefined);
  return row.id;
}
