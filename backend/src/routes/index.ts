import { Router } from 'express';
import { z } from 'zod';
import type {
  HealthResponse,
  OnboardRequest,
  OnboardResponse,
  BuildTransactionRequest,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import {
  listDistributionAccounts,
  getTreasuryConfig,
} from '../stellar/accounts.js';
import { verifyPrivyToken, ensureManagedWallet } from '../services/privy.js';
import { buildTransaction, submitTransaction } from '../stellar/transactions.js';
import {
  executeSettlementBatch,
  listSettlementBatches,
  getSettlementBatch,
} from '../stellar/settlement.js';

export const router = Router();

const VERSION = '0.1.0';

const scoutTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const createSettlementSchema = z.object({
  grossAmount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'grossAmount must be a 7-decimal number'),
  asset: assetRefOptional(),
  drivers: z
    .array(z.object({ userId: z.string().min(1), address: z.string().min(1), tier: scoutTierSchema }))
    .min(1),
});
function assetRefOptional() {
  return z.object({ code: z.string().min(1), issuer: z.string().optional() }).optional();
}

const assetSchema = z.object({ code: z.string().min(1), issuer: z.string().optional() });
const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment'), destination: z.string().min(1), asset: assetSchema, amount: z.string().min(1) }),
  z.object({ type: z.literal('createAccount'), destination: z.string().min(1), startingBalance: z.string().min(1) }),
  z.object({ type: z.literal('changeTrust'), asset: assetSchema, limit: z.string().optional() }),
]);
const buildTxSchema = z.object({
  userId: z.string().min(1),
  operations: z.array(operationSchema).min(1),
  memo: z.string().max(28).optional(),
});
const submitTxSchema = z.object({ xdr: z.string().min(1) });

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

// Delegated signing: build (+delegate-sign) a tx from the caller's managed wallet.
router.post('/v1/tx/build', async (req, res, next) => {
  try {
    const parsed = buildTxSchema.parse(req.body) as BuildTransactionRequest;
    res.json(await buildTransaction(parsed));
  } catch (e) {
    next(e);
  }
});

// Submit a signed transaction envelope (managed or external-wallet) to Horizon.
router.post('/v1/tx/submit', async (req, res, next) => {
  try {
    const { xdr } = submitTxSchema.parse(req.body);
    res.json(await submitTransaction(xdr));
  } catch (e) {
    next(e);
  }
});

// Settlement engine (D6): execute a 50/30/20 batch, list + drill down.
router.post('/v1/settlement/batches', async (req, res, next) => {
  try {
    const parsed = createSettlementSchema.parse(req.body);
    res.json(await executeSettlementBatch(parsed));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches', (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(listSettlementBatches(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches/:id', (req, res, next) => {
  try {
    res.json(getSettlementBatch(req.params.id));
  } catch (e) {
    next(e);
  }
});
