import type { Request, Response, NextFunction } from 'express';
import { getSessionFromRequest, type SessionPayload } from '../services/session.js';

/**
 * Rejects anonymous callers on endpoints that move value or expose per-user
 * data. Any valid session (google / wallet / guest / partner) passes.
 *
 * This is authentication, not authorisation — any session, including the
 * unverified one from `POST /v1/auth/guest`, satisfies it. Use it for
 * endpoints that are per-user (a caller may only touch their own records).
 * For endpoints that move protocol funds, use `requireRole('ops')`.
 */
export function requireSession() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!getSessionFromRequest(req)) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    next();
  };
}

/**
 * Restricts an endpoint to specific session methods — the operator gate for
 * anything that moves protocol funds (settlement, group payout, SDP fan-out,
 * SCOUT issuance, treasury reconfiguration).
 *
 * Anonymous callers get 401 (authenticate), signed-in-but-wrong-role callers
 * get 403 (you are known, and still not allowed) — so a driver holding a
 * perfectly valid session cannot trigger a settlement.
 */
export function requireRole(...allowed: SessionPayload['method'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    if (!allowed.includes(session.method)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `this endpoint requires an operator session (${allowed.join(' or ')})`,
      });
      return;
    }
    next();
  };
}
