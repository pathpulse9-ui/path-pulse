import { Router } from 'express';
import { z } from 'zod';
import type {
  HealthResponse,
  GoogleVerifyRequest,
  GoogleVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  AuthMeResponse,
  BuildTransactionRequest,
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
import { buildTransaction, submitTransaction } from '../stellar/transactions.js';
import {
  executeSettlementBatch,
  listSettlementBatches,
  getSettlementBatch,
} from '../stellar/settlement.js';
import {
  createWithdrawal,
  listWithdrawals,
  getWithdrawal,
  applyCallback,
} from '../services/offramp.js';
import { verifyCallbackSignature } from '../services/mercuryo.js';

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

// Fiat off-ramp (D4 — Mercuryo SEP-24): start an interactive withdrawal, list, poll.
const createWithdrawalSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'amount must be a 7-decimal number'),
  asset: assetRefOptional(),
  fiatCurrency: z.string().optional(),
  settlementBatchId: z.string().optional(),
});

router.post('/v1/offramp/sessions', async (req, res, next) => {
  try {
    const parsed = createWithdrawalSchema.parse(req.body);
    const session = getSessionFromRequest(req);
    const userId = session?.userId ?? 'sandbox-user';
    const userIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
    res.json(
      await createWithdrawal(userId, parsed, {
        email: session?.email,
        userIp,
        refundAddress: session?.address,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/v1/offramp/sessions', async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listWithdrawals(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/offramp/sessions/:id', async (req, res, next) => {
  try {
    res.json(await getWithdrawal(req.params.id));
  } catch (e) {
    next(e);
  }
});

// Mercuryo callback (webhook): verify X-Signature (HMAC-SHA256 of the raw body) then apply.
router.post('/v1/offramp/callback', (req, res) => {
  const raw = (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const signature = (req.headers['x-signature'] as string) ?? '';
  if (!verifyCallbackSignature(raw, signature)) {
    res.status(401).json({ error: 'InvalidSignature', message: 'callback signature verification failed' });
    return;
  }
  const payload = (req.body?.payload?.data ?? req.body?.data ?? {}) as {
    merchant_transaction_id?: string;
    status?: string;
  };
  if (payload.merchant_transaction_id && payload.status) {
    applyCallback(payload.merchant_transaction_id, payload.status);
  }
  res.status(200).json({ ok: true }); // Mercuryo needs a 200 to consider it delivered
});
