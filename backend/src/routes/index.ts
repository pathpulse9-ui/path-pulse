import { Router } from 'express';
import type {
  HealthResponse,
  GoogleVerifyRequest,
  GoogleVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  AuthMeResponse,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import {
  listDistributionAccounts,
  getTreasuryConfig,
} from '../stellar/accounts.js';
import { ensureAccountForEmail } from '../services/account.js';
import { verifyGoogleIdToken } from '../services/googleAuth.js';
import { buildChallenge, verifyChallenge } from '../services/walletAuth.js';
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
} from '../services/session.js';

export const router = Router();

const VERSION = '0.1.0';

router.get('/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    network: env.network,
    horizon: env.horizonUrl,
    version: VERSION,
  };
  res.json(body);
});

router.get('/v1/accounts/distribution', async (_req, res, next) => {
  try {
    res.json(await listDistributionAccounts());
  } catch (e) {
    next(e);
  }
});

router.get('/v1/treasury/config', async (_req, res, next) => {
  try {
    res.json(await getTreasuryConfig());
  } catch (e) {
    next(e);
  }
});

router.post('/v1/auth/google/verify', async (req, res, next) => {
  try {
    const { idToken } = req.body as GoogleVerifyRequest;
    const { email } = await verifyGoogleIdToken(idToken);
    const { userId, wallet } = await ensureAccountForEmail(email);
    setSessionCookie(res, { userId, method: 'google', email, address: wallet.address });
    const body: GoogleVerifyResponse = { userId, wallet };
    res.json(body);
  } catch (e) {
    (e as { status?: number }).status = 401;
    next(e);
  }
});

router.get('/v1/auth/challenge', async (req, res, next) => {
  try {
    const account = req.query.account;
    if (typeof account !== 'string' || !account) {
      res.status(400).json({ error: 'bad_request', message: 'account query param is required' });
      return;
    }
    const body: WalletChallengeResponse = buildChallenge(account);
    res.json(body);
  } catch (e) {
    (e as { status?: number }).status = 400;
    next(e);
  }
});

router.post('/v1/auth/wallet/verify', async (req, res, next) => {
  try {
    const { transaction } = req.body as WalletVerifyRequest;
    const { userId, address } = verifyChallenge(transaction);
    setSessionCookie(res, { userId, method: 'wallet', address });
    const body: WalletVerifyResponse = { userId, address };
    res.json(body);
  } catch (e) {
    (e as { status?: number }).status = 401;
    next(e);
  }
});

router.get('/v1/auth/me', (req, res) => {
  const session = getSessionFromRequest(req);
  const body: AuthMeResponse = {
    user: session
      ? { userId: session.userId, method: session.method, email: session.email, address: session.address }
      : null,
  };
  res.json(body);
});

router.post('/v1/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
