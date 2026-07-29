import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';

export interface SessionPayload {
  userId: string;
  method: 'google' | 'wallet';
  email?: string;
  address?: string;
}

export function createSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, env.session.secret, { expiresIn: env.session.maxAgeSeconds });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.session.secret) as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, payload: SessionPayload) {
  const token = createSessionToken(payload);
  res.cookie(env.session.cookieName, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: env.session.maxAgeSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(env.session.cookieName, { path: '/' });
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const token = req.cookies?.[env.session.cookieName];
  if (!token) return null;
  return verifySessionToken(token);
}
