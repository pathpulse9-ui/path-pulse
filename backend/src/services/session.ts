import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';

export type SessionRole = 'ops' | 'partner';

export interface SessionPayload {
  userId: string;
  method: 'google' | 'wallet' | 'guest' | 'partner';
  role?: SessionRole;
  roleExpiresAt?: number;
  email?: string;
  address?: string;
  jti?: string;
  exp?: number;
}

const ISSUER = 'pathpulse-api';
const AUDIENCE = 'pathpulse';
const revoked = new Map<string, number>();

export function roleOf(session: SessionPayload, now = Date.now()): SessionRole | undefined {
  if (session.role === 'ops') {
    return session.roleExpiresAt !== undefined && now < session.roleExpiresAt ? 'ops' : undefined;
  }
  if (session.role === 'partner') {
    return session.roleExpiresAt === undefined || now < session.roleExpiresAt ? 'partner' : undefined;
  }
  return session.method === 'partner' ? 'partner' : undefined;
}

export function withRole(session: SessionPayload, role: SessionRole | undefined, now = Date.now()): SessionPayload {
  const { userId, method, email, address } = session;
  if (!role) return { userId, method, email, address };
  const ttl = role === 'ops' ? env.session.opsRoleTtlSeconds : env.session.partnerRoleTtlSeconds;
  return { userId, method, email, address, role, roleExpiresAt: now + ttl * 1000 };
}

export function createSessionToken(payload: SessionPayload): string {
  const { jti: _jti, exp: _exp, ...claims } = payload;
  return jwt.sign(claims, env.session.secret, {
    algorithm: 'HS256',
    expiresIn: env.session.maxAgeSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: randomUUID(),
  });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, env.session.secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as SessionPayload & { iat?: number; iss?: string; aud?: string };
    if (!payload.jti || isRevoked(payload.jti)) return null;
    const { iat: _iat, iss: _iss, aud: _aud, ...session } = payload;
    return session;
  } catch {
    return null;
  }
}

function isRevoked(jti: string, now = Date.now()): boolean {
  const until = revoked.get(jti);
  if (until === undefined) return false;
  if (until <= now) {
    revoked.delete(jti);
    return false;
  }
  return true;
}

export async function revokeSession(session: SessionPayload | null): Promise<void> {
  if (!session?.jti) return;
  const expiresAt = (session.exp ?? Math.floor(Date.now() / 1000) + env.session.maxAgeSeconds) * 1000;
  revoked.set(session.jti, expiresAt);
  if (!env.databaseUrl) return;
  try {
    await db().query(
      'insert into revoked_sessions (jti, expires_at) values ($1, $2) on conflict (jti) do nothing',
      [session.jti, new Date(expiresAt)],
    );
  } catch (e) {
    logger.error({ err: e }, 'failed to persist session revocation');
  }
}

export async function loadRevokedSessions(): Promise<void> {
  if (!env.databaseUrl) return;
  await db().query('delete from revoked_sessions where expires_at < now()');
  const rows = await db().query<{ jti: string; expires_at: Date }>('select jti, expires_at from revoked_sessions');
  for (const r of rows.rows) revoked.set(r.jti, r.expires_at.getTime());
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookie(res: Response, payload: SessionPayload) {
  res.cookie(env.session.cookieName, createSessionToken(payload), {
    ...cookieOptions(),
    maxAge: env.session.maxAgeSeconds * 1000,
  });
}

export async function replaceSession(req: Request, res: Response, payload: SessionPayload): Promise<void> {
  await revokeSession(getSessionFromRequest(req));
  setSessionCookie(res, payload);
}

export async function endSession(req: Request, res: Response): Promise<void> {
  await revokeSession(getSessionFromRequest(req));
  res.clearCookie(env.session.cookieName, cookieOptions());
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const token = req.cookies?.[env.session.cookieName];
  if (!token) return null;
  return verifySessionToken(token);
}
