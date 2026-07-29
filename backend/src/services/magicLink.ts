import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ensureAccountForEmail } from './account.js';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;

interface MagicLinkTokenPayload {
  purpose: 'magic-link';
  email: string;
}

function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed.includes('@')) throw new Error('invalid email');
  return trimmed;
}

export function requestMagicLink(email: string): { devLink?: string } {
  const normalized = normalizeEmail(email);
  const payload: MagicLinkTokenPayload = { purpose: 'magic-link', email: normalized };
  const token = jwt.sign(payload, env.session.secret, { expiresIn: MAGIC_LINK_TTL_SECONDS });
  const link = `${env.webAppUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  logger.info({ email: normalized, link }, 'Magic link generated (dev stub — no email provider wired)');
  return { devLink: env.nodeEnv === 'development' ? link : undefined };
}

export async function verifyMagicLink(token: string) {
  let payload: MagicLinkTokenPayload;
  try {
    payload = jwt.verify(token, env.session.secret) as MagicLinkTokenPayload;
  } catch {
    throw new Error('Invalid or expired magic link');
  }
  if (payload.purpose !== 'magic-link') throw new Error('Invalid token purpose');
  const { userId, wallet } = await ensureAccountForEmail(payload.email);
  return { userId, wallet, email: payload.email };
}
