import { Router } from 'express';
import type {
  HealthResponse,
  OnboardRequest,
  OnboardResponse,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import {
  listDistributionAccounts,
  getTreasuryConfig,
} from '../stellar/accounts.js';
import { verifyPrivyToken, ensureManagedWallet } from '../services/privy.js';

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

router.post('/v1/onboard', async (req, res, next) => {
  try {
    const { privyToken } = req.body as OnboardRequest;
    const user = await verifyPrivyToken(privyToken);
    const wallet = await ensureManagedWallet(user);
    const body: OnboardResponse = { userId: user.userId, wallet };
    res.json(body);
  } catch (e) {
    next(e);
  }
});
