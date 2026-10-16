import type { Request, Response, NextFunction } from 'express';
import { getSessionFromRequest, roleOf, type SessionRole } from '../services/session.js';
import { parsePartnerKey, verifyPartnerKey } from '../services/partnerKeys.js';

export type PartnerKeyRequest = Request & { partnerKeyId?: string };

export function requireSession() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!getSessionFromRequest(req)) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    next();
  };
}

export function callerRole(req: Request): SessionRole | undefined {
  if ((req as PartnerKeyRequest).partnerKeyId) return 'partner';
  const session = getSessionFromRequest(req);
  return session ? roleOf(session) : undefined;
}

export function identifyPartnerKey() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (getSessionFromRequest(req) || !parsePartnerKey(req.headers.authorization)) {
      next();
      return;
    }
    try {
      const keyId = await verifyPartnerKey(req);
      if (!keyId) {
        res.status(401).json({ error: 'Unauthorized', message: 'invalid or revoked partner API key' });
        return;
      }
      (req as PartnerKeyRequest).partnerKeyId = keyId;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(...allowed: SessionRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = getSessionFromRequest(req);
    if (!session) {
      if (allowed.includes('partner') && parsePartnerKey(req.headers.authorization)) {
        try {
          const keyId = await verifyPartnerKey(req);
          if (keyId) {
            (req as PartnerKeyRequest).partnerKeyId = keyId;
            next();
            return;
          }
        } catch (e) {
          next(e);
          return;
        }
        res.status(401).json({ error: 'Unauthorized', message: 'invalid or revoked partner API key' });
        return;
      }
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    const role = roleOf(session);
    if (!role || !allowed.includes(role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `this endpoint requires an operator session (${allowed.join(' or ')})`,
      });
      return;
    }
    next();
  };
}
