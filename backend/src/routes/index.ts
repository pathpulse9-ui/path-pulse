import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  HealthResponse,
  GoogleVerifyRequest,
  GoogleVerifyResponse,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletVerifyResponse,
  GuestSessionResponse,
  PartnerLoginResponse,
  OpsLoginResponse,
  AuthMeResponse,
  BuildTransactionRequest,
  SettlementBatch,
  SettlementBatchPage,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import {
  listDistributionAccounts,
  getTreasuryConfig,
  buildTreasuryMultisigTx,
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
import { batchesToCsv, batchReceiptPdf } from '../services/settlementExport.js';
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
  whitelistWallet,
  type CarretKycStatusResponse,
} from '../services/carret.js';
import { carretLive } from '../config/env.js';
import {
  getMapping, getMappingByEmail, getMappingByPhone,
  upsertMapping, deleteMapping, markWalletWhitelisted,
} from '../services/carretSubAccountStore.js';
import { idempotency } from '../services/idempotency.js';
import { requireSession, requireRole } from '../middleware/requireSession.js';
import { allRemaining, CARRET_DAILY_LIMIT_INR } from '../services/carretLimits.js';
import multer from 'multer';
import { assignSampleTier, getOnchainTier, getScoutConfig, revokeTier } from '../stellar/scout.js';
import { createPayoutBatch, listPayoutBatches, getPayoutBatch } from '../services/payouts.js';
import { listAttempts } from '../services/payoutAttempts.js';
import { quoteSwap, executeSwap } from '../routing/aggregator.js';
import { listRoutableAssets } from '../routing/assets.js';
import { getTreasuryRoutingPlan } from '../routing/treasury.js';

export const router = Router();

const VERSION = '0.1.0';

const scoutTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const revokeScoutSchema = z.object({ address: z.string().min(1) });
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

/**
 * Build (but do not sign or submit) the multisig-configuration transaction for
 * the treasury account. Human-gated by design — a signatory reviews the XDR in
 * Stellar Laboratory and signs it out-of-band. The backend never auto-signs
 * treasury reconfiguration.
 */
router.post('/v1/treasury/multisig/build', requireRole('ops'), async (_req, res, next) => {
  try {
    res.json(await buildTreasuryMultisigTx());
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
    const { userId, address } = await verifyChallenge(transaction);
    setSessionCookie(res, { userId, method: 'wallet', address });

    // PAT-76: auto-whitelist the driver's Stellar address with Carret if
    // they already have a sub-account on file. Non-blocking — the sign-in
    // succeeds even if whitelist fails; a "resync wallet" affordance in
    // the mobile profile can retry.
    autoWhitelistWallet(userId, address).catch((e) =>
      // eslint-disable-next-line no-console
      console.warn(`[carret] auto-whitelist failed for ${userId}: ${(e as Error).message}`),
    );

    const body: WalletVerifyResponse = { userId, address };
    res.json(body);
  } catch (e) {
    (e as { status?: number }).status = 401;
    next(e);
  }
});

/** PAT-76 helper — fire-and-forget wallet whitelist call. */
async function autoWhitelistWallet(userId: string, address: string): Promise<void> {
  if (!carretLive) return;
  const mapping = await getMapping(userId);
  if (!mapping) return; // no Carret sub-account yet — whitelisted on first provision
  if (mapping.walletWhitelistedAt) return; // already done
  await whitelistWallet(mapping.carretAccountId, address);
  await markWalletWhitelisted(userId);
}

router.post('/v1/auth/guest', (_req, res) => {
  const userId = `guest_${randomUUID()}`;
  setSessionCookie(res, { userId, method: 'guest' });
  const body: GuestSessionResponse = { userId };
  res.json(body);
});

/** Constant-time passcode compare — avoids leaking match length via timing. */
function passcodeMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Gov Settlement Gateway (D8): partner access gate. Shared passcode issued
// out-of-band to government/partner reviewers — not a per-user identity,
// just a wall between the public internet and the transparency dashboard.
router.post('/v1/auth/partner/login', (req, res) => {
  const { passcode } = req.body as { passcode?: string };
  if (!env.govPartnerPasscode) {
    res.status(500).json({ error: 'ConfigError', message: 'GOV_PARTNER_PASSCODE not configured' });
    return;
  }
  if (typeof passcode !== 'string' || !passcodeMatches(passcode, env.govPartnerPasscode)) {
    res.status(401).json({ error: 'Unauthorized', message: 'invalid passcode' });
    return;
  }
  const userId = `partner_${randomUUID()}`;
  setSessionCookie(res, { userId, method: 'partner' });
  const body: PartnerLoginResponse = { userId };
  res.json(body);
});

// Operator gate. Everything that moves protocol funds (settlement, group
// payout, SDP fan-out, SCOUT issuance, treasury reconfiguration) requires this
// session method — a driver's ordinary session is deliberately not enough.
router.post('/v1/auth/ops/login', (req, res) => {
  const { passcode } = req.body as { passcode?: string };
  if (!env.opsPasscode) {
    res.status(500).json({ error: 'ConfigError', message: 'OPS_PASSCODE not configured' });
    return;
  }
  if (typeof passcode !== 'string' || !passcodeMatches(passcode, env.opsPasscode)) {
    res.status(401).json({ error: 'Unauthorized', message: 'invalid passcode' });
    return;
  }
  const userId = `ops_${randomUUID()}`;
  setSessionCookie(res, { userId, method: 'ops' });
  const body: OpsLoginResponse = { userId };
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
router.post('/v1/settlement/batches', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const parsed = createSettlementSchema.parse(req.body);
    res.json(await executeSettlementBatch(parsed));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches', async (req, res, next) => {
  try {
    const s = (k: string): string | undefined =>
      typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined;
    res.json(
      await listSettlementBatches({
        cursor:    s('cursor'),
        limit:     req.query.limit ? Number(req.query.limit) : undefined,
        network:   s('network'),
        assetCode: s('assetCode'),
        since:     s('since'),
        until:     s('until'),
        minAmount: s('minAmount'),
        maxAmount: s('maxAmount'),
      }),
    );
  } catch (e) {
    next(e);
  }
});

// ── Compliance exports (D8 gov dashboard + partner finance) ──────────────
// IMPORTANT: these more-specific routes must be registered BEFORE the
// generic `/v1/settlement/batches/:id` matcher, or Express matches `:id`
// = "export.csv" first and 404s with "Settlement batch export.csv not
// found" (real bug I caught the first time production hit the endpoint).

router.get('/v1/settlement/batches/export.csv', async (req, res, next) => {
  try {
    const s = (k: string): string | undefined =>
      typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined;
    // Pull up to 1000 batches in a single export — walk cursor to gather more.
    const items: SettlementBatch[] = [];
    let cursor: string | null | undefined = undefined;
    for (let i = 0; i < 20; i++) {
      const page: SettlementBatchPage = await listSettlementBatches({
        cursor:    cursor ?? undefined,
        limit:     100,
        network:   s('network'),
        assetCode: s('assetCode'),
        since:     s('since'),
        until:     s('until'),
        minAmount: s('minAmount'),
        maxAmount: s('maxAmount'),
      });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const csv = batchesToCsv(items);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pathpulse-settlements-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches/:id/receipt.pdf', async (req, res, next) => {
  try {
    const batch = await getSettlementBatch(req.params.id);
    const pdf = await batchReceiptPdf(batch);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="pathpulse-batch-${batch.id}.pdf"`,
    );
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

// Generic per-batch lookup — registered AFTER the two more-specific
// routes above so Express's linear route match hits export.csv and
// receipt.pdf first.
router.get('/v1/settlement/batches/:id', async (req, res, next) => {
  try {
    res.json(await getSettlementBatch(req.params.id));
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


router.post('/v1/settlement/group-payouts', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const parsed = createGroupPayoutSchema.parse(req.body);
    res.json(await executeGroupPayout(parsed));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/group-payouts', async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listGroupPayoutBatches(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/group-payouts/:id', async (req, res, next) => {
  try {
    res.json(await getGroupPayoutBatch(req.params.id));
  } catch (e) {
    next(e);
  }
});

const createPayoutBatchSchema = z.object({ settlementBatchId: z.string().min(1) });

router.post('/v1/ops/payouts/batches', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const { settlementBatchId } = createPayoutBatchSchema.parse(req.body);
    const settlementBatch = await getSettlementBatch(settlementBatchId);
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

// Reconciliation: every SDP call attempt for a batch, including failures and retries.
router.get('/v1/ops/payouts/batches/:id/attempts', async (req, res, next) => {
  try {
    res.json({ batchId: req.params.id, attempts: await listAttempts(req.params.id) });
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

router.post('/v1/offramp/sessions', requireSession(), idempotency(), async (req, res, next) => {
  try {
    const parsed = createWithdrawalSchema.parse(req.body);
    const session = getSessionFromRequest(req)!;
    const userIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
    res.json(
      await createWithdrawal(session.userId, parsed, {
        email: session.email,
        userIp,
        userAddress: session.address,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/v1/offramp/sessions', requireSession(), async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listWithdrawals(getSessionFromRequest(req)!.userId, cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/offramp/sessions/:id', requireSession(), async (req, res, next) => {
  try {
    res.json(await getWithdrawal(req.params.id, getSessionFromRequest(req)!.userId));
  } catch (e) {
    next(e);
  }
});

// Cross-asset routing (D5): quote across active routers, then execute the best route.
const routableSchema = z.string().min(1);
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

// Treasury routing (D5): what non-settlement balances the treasury holds and quotes to convert them.
router.get('/v1/routing/treasury/plan', async (_req, res, next) => {
  try {
    res.json(await getTreasuryRoutingPlan());
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

router.post('/v1/scout/assign', requireRole('ops'), async (req, res, next) => {
  try {
    const { score } = assignScoutSchema.parse(req.body);
    res.json(await assignSampleTier(score));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/scout/revoke', requireRole('ops'), async (req, res, next) => {
  try {
    const { address } = revokeScoutSchema.parse(req.body);
    res.json(await revokeTier(address));
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
  // Carret expects a bare 10-digit local number (no `+`, no country code).
  // Mobile clients strip both before sending. See:
  // https://carret-fluid.gitbook.io/carret_infra_api_documentation/account-management/sub-account
  phone_number: z.string().regex(/^\d{10}$/, 'phone_number must be 10 digits'),
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

/**
 * PAT-75: session-authed find-or-create. Returns the current driver's Carret
 * sub-account id, creating a fresh one on Carret if they don't have one yet.
 * Every downstream KYC / off-ramp call resolves the account id through
 * `getMapping(userId)` instead of the shared env fallback.
 */
/**
 * Session-authed find-or-create with cross-session resume by email.
 *
 * Resolution order:
 *   1. This session already has a mapping → return it (existed: true)
 *   2. Someone (maybe an earlier install) already registered this email
 *      on Carret and we saved that mapping → adopt it into this
 *      session's userId, return existed: true
 *   3. Neither — create a fresh Carret sub-account and persist the mapping
 *
 * The email-lookup fallback (step 2) is what lets a driver come back on a
 * new install / cleared cookies and continue their KYC without hitting
 * Carret's "user with this email already exists" 4xx.
 */
router.post('/v1/carret/provision-subaccount', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }

    // Step 1 — same session, already has a Carret account.
    const existing = await getMapping(session.userId);
    if (existing) {
      res.json({
        carretAccountId: existing.carretAccountId,
        kycStatus: existing.kycStatus,
        existed: true,
      });
      return;
    }

    const parsed = createSubAccountSchema.parse(req.body);

    // Step 2 — different session but same email OR same phone → adopt.
    // Carret rejects duplicates on both (`user with this email already
    // exists` and `A user with that username already exists` — where
    // "username" is derived from phone), so we look up on either.
    const adoptedRow =
      (await getMappingByEmail(parsed.email)) ??
      (await getMappingByPhone(parsed.phone_number));
    if (adoptedRow) {
      const adopted = await upsertMapping({
        userId: session.userId,
        carretAccountId: adoptedRow.carretAccountId,
        referenceId: adoptedRow.referenceId,
        kycStatus: adoptedRow.kycStatus,
        walletWhitelistedAt: adoptedRow.walletWhitelistedAt,
        email: parsed.email,
        phone: parsed.phone_number,
      });
      res.json({
        carretAccountId: adopted.carretAccountId,
        kycStatus: adopted.kycStatus,
        existed: true,
      });
      return;
    }

    // Step 3 — genuinely new user + email + phone → create.
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '0.0.0.0';
    const account = await createSubAccount({
      ...parsed,
      user_ip_address: parsed.user_ip_address ?? clientIp,
    });
    const mapping = await upsertMapping({
      userId: session.userId,
      carretAccountId: String(account.id),
      referenceId: account.reference_id,
      kycStatus: account.kyc_status,
      email: parsed.email,
      phone: parsed.phone_number,
    });
    res.json({
      carretAccountId: mapping.carretAccountId,
      kycStatus: mapping.kycStatus,
      existed: false,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Resume the current session's KYC application (if any). Returns the
 * saved Carret accountId + latest kycStatus, or 204 when the driver has
 * never provisioned a sub-account. Used by the wizard on mount to jump
 * straight to the appropriate step instead of re-asking for name / DOB.
 */
router.get('/v1/carret/resume', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(204).end();
      return;
    }
    res.json({
      carretAccountId: mapping.carretAccountId,
      kycStatus: mapping.kycStatus,
      email: mapping.email,
      referenceId: mapping.referenceId,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * "Hard reset" for the wizard's Start-fresh affordance.
 *   1. Cleans up any pending KYC session on Carret for the current mapping
 *      (best-effort — network / no-session errors don't fail the whole reset)
 *   2. Deletes the mapping row so the next /provision creates a genuinely
 *      fresh account. Without this, provision returned the stale accountId
 *      keyed on the (unchanged) guest cookie and silently adopted the driver
 *      back into the old Carret account even after they typed a new email.
 * Idempotent: safe to call when no mapping exists (returns { cleared: false }).
 */
router.post('/v1/carret/session/reset', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.json({ cleared: false });
      return;
    }
    try { await cleanupKyc(mapping.carretAccountId); } catch { /* best-effort */ }
    await deleteMapping(session.userId);
    res.json({ cleared: true, wasAccountId: mapping.carretAccountId });
  } catch (e) {
    next(e);
  }
});

/**
 * PAT-80: Carret daily limits for the current session user. Returns per-
 * activity remaining budget (₹) so the UI can render a "₹X available today"
 * chip and gray out the submit button when the user's amount exceeds it.
 * 401 when unauth; 404 when no Carret sub-account provisioned yet.
 */
router.get('/v1/carret/limits', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(404).json({
        error: 'CarretNotProvisioned',
        message: 'Provision a Carret sub-account first (POST /v1/carret/provision-subaccount).',
      });
      return;
    }
    const remaining = await allRemaining(mapping.carretAccountId);
    res.json({
      carretAccountId: mapping.carretAccountId,
      dailyCapInr: CARRET_DAILY_LIMIT_INR,
      remaining,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/v1/carret/subaccount', requireSession(), async (req, res, next) => {
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

/**
 * Idempotent wrapper over Carret's POST /kyc/initiate/. Carret rejects a
 * second initiate on the same account with 4xx "KYC session already exists
 * in pending state." That's not really an error for us — we just want the
 * current session id. So on that specific failure we fall back to
 * `getKycStatus`, extract the existing `kyc_session`, and hand it back in
 * the same response shape the client expects on a fresh initiate.
 */
router.post('/v1/carret/kyc/initiate', requireSession(), async (req, res, next) => {
  try {
    const { account_id } = initiateKycSchema.parse(req.body);
    try {
      res.json(await initiateKyc(account_id));
    } catch (e) {
      const msg = String((e as Error).message ?? '').toLowerCase();
      const status = (e as { status?: number }).status;
      const looksLikeDuplicate = status === 422 && msg.includes('already exists');
      if (!looksLikeDuplicate) throw e;
      // Pull the still-pending session id off the status endpoint.
      const status_ = await getKycStatus(account_id);
      // Carret wraps: `{success, kyc_info: {kyc_session, kyc_status, …}}` on
      // the newer taas v2.0 shape. Handle both wrapped + flat responses.
      const info = (status_ as unknown as { kyc_info?: CarretKycStatusResponse }).kyc_info ?? status_;
      const sessionId = info.kyc_session;
      if (!sessionId) throw e;
      res.json({
        success: true,
        message: 'Resuming existing KYC session',
        session: { session_id: sessionId, status: info.kyc_status },
      });
    }
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

router.post('/v1/carret/kyc/document', requireSession(), async (req, res, next) => {
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
  requireSession(),
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

router.get('/v1/carret/kyc/status/:accountId', requireSession(), async (req, res, next) => {
  try {
    res.json(await getKycStatus(req.params.accountId));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/carret/kyc/cleanup', requireSession(), async (req, res, next) => {
  try {
    const { account_id } = initiateKycSchema.parse(req.body);
    res.json(await cleanupKyc(account_id));
  } catch (e) {
    next(e);
  }
});
