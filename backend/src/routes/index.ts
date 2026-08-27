import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  HealthResponse,
  GoogleVerifyRequest,
  GoogleVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  GuestSessionResponse,
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
import { buildChallenge, verifyChallenge, serverSigningKey } from '../services/walletAuth.js';
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
  executeGroupPayout,
  listGroupPayoutBatches,
  getGroupPayoutBatch,
} from '../stellar/groupPayout.js';
import {
  createWithdrawal,
  listWithdrawals,
  getWithdrawal,
  applyCallback,
  applyCarretCallback,
  activeProvider,
  quoteWithdrawal,
} from '../services/offramp.js';
import { verifyRampWebhook } from '../services/ramp.js';
import {
  verifyCarretWebhook,
  createSubAccount,
  initiateKyc,
  submitKycDocument,
  uploadKycFile,
  getKycStatus,
  cleanupKyc,
} from '../services/carret.js';
import multer from 'multer';
import { assignSampleTier, getOnchainTier, getScoutConfig } from '../stellar/scout.js';
import { createPayoutBatch, listPayoutBatches, getPayoutBatch } from '../services/payouts.js';
import { quoteSwap, executeSwap } from '../routing/swap.js';
import { listRoutableAssets } from '../routing/assets.js';

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
  operations: z.array(operationSchema).min(1),
  memo: z.string().max(28).optional(),
});
const submitTxSchema = z.object({ xdr: z.string().min(1) });

router.get('/.well-known/stellar.toml', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.type('text/plain').send(
    [
      'VERSION="2.0.0"',
      `NETWORK_PASSPHRASE="${env.networkPassphrase}"`,
      `HORIZON_URL="${env.horizonUrl}"`,
      `WEB_AUTH_ENDPOINT="https://${env.sep10.homeDomain}/v1/auth/challenge"`,
      `SIGNING_KEY="${serverSigningKey()}"`,
      '',
    ].join('\n'),
  );
});

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

router.post('/v1/auth/guest', (_req, res) => {
  const userId = `guest_${randomUUID()}`;
  setSessionCookie(res, { userId, method: 'guest' });
  const body: GuestSessionResponse = { userId };
  res.json(body);
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
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized', message: 'sign in first' });
      return;
    }
    const parsed = buildTxSchema.parse(req.body);
    res.json(await buildTransaction({ ...parsed, userId: session.userId } as BuildTransactionRequest));
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

// Bulk group payout (CSV/Excel upload): flat, exact-amount payments, no split/tier logic.
const groupPayoutRecipientSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/, 'amount must be a 7-decimal number'),
  remark: z.string().max(120).optional(),
});
const createGroupPayoutSchema = z.object({
  asset: assetRefOptional(),
  memo: z.string().max(28, 'memo must be 28 characters or fewer').optional(),
  recipients: z.array(groupPayoutRecipientSchema).min(1).max(100),
});


router.post('/v1/settlement/group-payouts', async (req, res, next) => {
  try {
    const parsed = createGroupPayoutSchema.parse(req.body);
    res.json(await executeGroupPayout(parsed));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/group-payouts', (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(listGroupPayoutBatches(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/group-payouts/:id', (req, res, next) => {
  try {
    res.json(getGroupPayoutBatch(req.params.id));
  } catch (e) {
    next(e);
  }
});

const createPayoutBatchSchema = z.object({ settlementBatchId: z.string().min(1) });

router.post('/v1/ops/payouts/batches', async (req, res, next) => {
  try {
    const { settlementBatchId } = createPayoutBatchSchema.parse(req.body);
    const settlementBatch = getSettlementBatch(settlementBatchId);
    res.json(
      await createPayoutBatch(settlementBatch.driverPayouts, settlementBatch.asset, { settlementBatchId }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/payouts/batches', async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listPayoutBatches(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/payouts/batches/:id', async (req, res, next) => {
  try {
    res.json(await getPayoutBatch(req.params.id));
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

router.get('/v1/offramp/quotes', async (req, res, next) => {
  try {
    const amount = typeof req.query.amount === 'string' ? req.query.amount : '';
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
      const e = new Error('amount must be a positive 7-decimal number') as Error & { status: number };
      e.name = 'ValidationError';
      e.status = 400;
      throw e;
    }
    res.json(await quoteWithdrawal(amount));
  } catch (e) {
    next(e);
  }
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
        userAddress: session?.address,
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

// Aquarius AMM routing (D5): quote a swap route, then execute it through the router contract.
const routableSchema = z.enum(['XLM', 'USDC']);
const amountSchema = z.string().regex(/^\d+(\.\d{1,7})?$/, 'amount must be a 7-decimal number');
const routingQuoteSchema = z.object({
  from: routableSchema,
  to: routableSchema,
  amount: amountSchema,
});
const routingSwapSchema = routingQuoteSchema;

router.get('/v1/routing/assets', (_req, res, next) => {
  try {
    res.json({ items: listRoutableAssets().map((a) => ({ symbol: a.symbol, ...a.ref })) });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/routing/quote', async (req, res, next) => {
  try {
    const { from, to, amount } = routingQuoteSchema.parse(req.query);
    res.json(await quoteSwap(from, to, amount));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/routing/swap', async (req, res, next) => {
  try {
    if (!getSessionFromRequest(req)) {
      const denied = new Error('Sign in to execute a conversion') as Error & { status: number };
      denied.name = 'Unauthorized';
      denied.status = 401;
      throw denied;
    }
    const { from, to, amount } = routingSwapSchema.parse(req.body);
    res.status(201).json(await executeSwap(from, to, amount));
  } catch (e) {
    next(e);
  }
});

// SCOUT reputation assets (D6): config, assign a tier from a PulseGen score, look up on-chain tier.
const assignScoutSchema = z.object({ score: z.number().min(0).max(1) });

router.get('/v1/scout', async (_req, res, next) => {
  try {
    res.json(await getScoutConfig());
  } catch (e) {
    next(e);
  }
});

router.post('/v1/scout/assign', async (req, res, next) => {
  try {
    const { score } = assignScoutSchema.parse(req.body);
    res.json(await assignSampleTier(score));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/scout/:address', async (req, res, next) => {
  try {
    const { tier, multiplier } = await getOnchainTier(req.params.address);
    res.json({ address: req.params.address, tier, multiplier });
  } catch (e) {
    next(e);
  }
});

/**
 * Off-ramp webhook. Provider-shaped:
 *  - Ramp:   verify ECDSA `X-Body-Signature` over the raw body; correlate by `ref` query.
 *  - Carret: verify HMAC-SHA256 `X-Carret-Signature` (scheme assumed — TBD with Carret);
 *            correlate by `order_id` in the JSON body.
 * Both need a 200 to be considered delivered.
 */
router.post('/v1/offramp/callback', (req, res) => {
  const raw = (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  if (activeProvider() === 'carret') {
    const signature = (req.headers['x-carret-signature'] as string) ?? '';
    if (!verifyCarretWebhook(raw, signature)) {
      res.status(401).json({ error: 'InvalidSignature', message: 'webhook signature verification failed' });
      return;
    }
    const body = req.body as {
      order_id?: string;
      status?: string;
      data?: { order_id?: string; status?: string };
    };
    const orderId = body.order_id ?? body.data?.order_id;
    const status = body.status ?? body.data?.status;
    if (orderId && status) applyCarretCallback(orderId, status);
    res.status(200).json({ ok: true });
    return;
  }

  // Ramp (default)
  const signature = (req.headers['x-body-signature'] as string) ?? '';
  if (!verifyRampWebhook(raw, signature)) {
    res.status(401).json({ error: 'InvalidSignature', message: 'webhook signature verification failed' });
    return;
  }
  const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
  const body = req.body as { type?: string; status?: string; payload?: { status?: string } };
  const status = body.type ?? body.status ?? body.payload?.status;
  if (ref && status) applyCallback(ref, status);
  res.status(200).json({ ok: true });
});

// ── Carret KYC proxy (D4 dev-onboarding) ──────────────────────────────
// Thin proxies to Carret Infra's /api/v2.0/taas/kyc/* endpoints so the web
// UI can drive the full KYC flow (initiate → PAN JSON → Aadhaar XML file →
// selfie image → poll status) without exposing the API-KEY to the browser.
// Multer stores files in memory only — they're forwarded to Carret in the
// same request, never written to disk.

const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const createSubAccountSchema = z.object({
  email: z.string().email(),
  phone_number: z.string().min(10).max(12),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  user_ip_address: z.string().min(1).optional(),
  annual_income: z.string().min(1),
  is_email_verified: z.boolean().default(true),
  is_mobile_number_verified: z.boolean().default(true),
  country: z.string().length(2),
  gender: z.enum(['male', 'female', 'other']),
  occupation: z.string().min(1),
  is_politicaly_exposed_person: z.boolean().default(false),
  dob: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
});

router.post('/v1/carret/subaccount', async (req, res, next) => {
  try {
    const parsed = createSubAccountSchema.parse(req.body);
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '0.0.0.0';
    const account = await createSubAccount({
      email: parsed.email,
      phone_number: parsed.phone_number,
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      user_ip_address: parsed.user_ip_address ?? clientIp,
      annual_income: parsed.annual_income,
      is_email_verified: parsed.is_email_verified,
      is_mobile_number_verified: parsed.is_mobile_number_verified,
      country: parsed.country,
      gender: parsed.gender,
      occupation: parsed.occupation,
      is_politicaly_exposed_person: parsed.is_politicaly_exposed_person,
      dob: parsed.dob,
    });
    res.json(account);
  } catch (e) {
    next(e);
  }
});

const initiateKycSchema = z.object({ account_id: z.union([z.number(), z.string()]) });

router.post('/v1/carret/kyc/initiate', async (req, res, next) => {
  try {
    const { account_id } = initiateKycSchema.parse(req.body);
    res.json(await initiateKyc(account_id));
  } catch (e) {
    next(e);
  }
});

const submitDocSchema = z.object({
  kyc_session_id: z.string().min(1),
  document: z.object({
    document_type: z.enum(['pan', 'aadhaar', 'voter_id', 'passport', 'driving_license', 'selfie']),
    document_number: z.string().optional(),
    name: z.string().optional(),
    dob: z.string().optional(),
    surname_from_passport: z.string().optional(),
    file_number: z.string().optional(),
    date_of_issue: z.string().optional(),
  }),
});

router.post('/v1/carret/kyc/document', async (req, res, next) => {
  try {
    const { kyc_session_id, document } = submitDocSchema.parse(req.body);
    res.json(await submitKycDocument({ kycSessionId: kyc_session_id, document }));
  } catch (e) {
    next(e);
  }
});

// Multipart file upload — multer parses `doc_front` (and optional `doc_back`)
// alongside the JSON-ish fields (kyc_session, doc_type, file_type).
router.post(
  '/v1/carret/kyc/file',
  kycUpload.fields([
    { name: 'doc_front', maxCount: 1 },
    { name: 'doc_back', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const kyc_session = String(req.body.kyc_session ?? '');
      const doc_type = String(req.body.doc_type ?? '');
      const file_type = String(req.body.file_type ?? '');
      if (!kyc_session || !doc_type || !file_type) {
        res.status(400).json({ error: 'bad_request', message: 'kyc_session, doc_type, file_type all required' });
        return;
      }
      if (!['pan', 'aadhaar', 'voter_id', 'passport', 'driving_license', 'selfie'].includes(doc_type)) {
        res.status(400).json({ error: 'bad_request', message: `unsupported doc_type: ${doc_type}` });
        return;
      }
      if (!['image', 'xml'].includes(file_type)) {
        res.status(400).json({ error: 'bad_request', message: `file_type must be image or xml, got: ${file_type}` });
        return;
      }
      const files = req.files as { [k: string]: Express.Multer.File[] } | undefined;
      const front = files?.doc_front?.[0];
      if (!front) {
        res.status(400).json({ error: 'bad_request', message: 'doc_front file missing' });
        return;
      }
      const back = files?.doc_back?.[0];
      res.json(
        await uploadKycFile({
          kycSessionId: kyc_session,
          docType: doc_type as 'pan' | 'aadhaar' | 'voter_id' | 'passport' | 'driving_license' | 'selfie',
          fileType: file_type as 'image' | 'xml',
          filename: front.originalname,
          fileBuffer: front.buffer,
          contentType: front.mimetype,
          docBack: back
            ? { filename: back.originalname, fileBuffer: back.buffer, contentType: back.mimetype }
            : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.get('/v1/carret/kyc/status/:accountId', async (req, res, next) => {
  try {
    res.json(await getKycStatus(req.params.accountId));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/carret/kyc/cleanup', async (req, res, next) => {
  try {
    const { account_id } = initiateKycSchema.parse(req.body);
    res.json(await cleanupKyc(account_id));
  } catch (e) {
    next(e);
  }
});
