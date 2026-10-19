import { Router, type Request, type Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
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
  OpsStatusResponse,
  SettlementBatch,
  SettlementBatchPage,
  GroupPayoutBatch,
  OffRampStatus,
} from '@pathpulse/contract';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  listDistributionAccounts,
  getTreasuryConfig,
  buildTreasuryMultisigTx,
} from '../stellar/accounts.js';
import { ensureAccountForEmail } from '../services/account.js';
import { verifyGoogleIdToken } from '../services/googleAuth.js';
import { buildChallenge, verifyChallenge, serverSigningKey } from '../services/walletAuth.js';
import {
  replaceSession,
  endSession,
  getSessionFromRequest,
  roleOf,
  withRole,
  type SessionPayload,
} from '../services/session.js';
import { clearFailures, isLockedOut, recordFailure } from '../services/loginGuard.js';
import { totpRequired, verifyOperatorTotp } from '../services/totp.js';
import { isReplay } from '../services/webhookReplay.js';
import { executeConvertedSettlement } from '../stellar/convertedSettlement.js';
import { indexerStatus, listLedger } from '../services/chainIndexer.js';
import { buildTransaction, submitTransaction } from '../stellar/transactions.js';
import {
  executeSettlementBatch,
  listSettlementBatches,
  getSettlementBatch,
  getSettlementBatchWithPayouts,
  attachStoredPayoutHashes,
  fromStroops,
  toStroops,
} from '../stellar/settlement.js';
import { batchesToCsv, batchReceiptPdf, payoutsToCsv } from '../services/settlementExport.js';
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
  retryDepositRegistration,
  activeProvider,
  quoteWithdrawal,
} from '../services/offramp.js';
import {
  getQuote as onrampGetQuote,
  createDeposit as onrampCreateDeposit,
  listSessions as onrampListSessions,
  getSession as onrampGetSession,
} from '../services/onramp.js';
import {
  listAllSessions,
  listEvents,
  recordEvent as offrampRecordEvent,
  saveSession as offrampSaveSession,
  getSession as offrampGetSession,
} from '../services/offRampStore.js';
import {
  parseScoreCsv,
  pulseGenEndpointHost,
  pulseGenLive,
  resolveScore,
  validateScoreBatch,
} from '../services/pulsegen.js';
import {
  countScores,
  getImport,
  hashPayload,
  listImports,
  latestAssignments,
  listLatestScores,
  listScores,
  saveImport,
} from '../services/scoreStore.js';
import { reconcileOnce } from '../services/orphanReconciler.js';
import { db as offrampDb } from '../db/client.js';
import { amountParam, batchFilters, cursorParam, exportRange, limitParam, stellarAddressParam } from './queryParams.js';
import { logUpstream } from '../util/upstreamLog.js';
import { fetchWithTimeout } from '../net/fetchWithTimeout.js';
import { sendCarretDeposit } from '../services/carretDeposit.js';

/**
 * D4/T2 demo helper: roll a completed session back to pending (as if the
 * Carret webhook that marked it filled was never received) and push
 * updated_at 2 minutes into the past so the next reconciler pass picks
 * it up without waiting out the 30s stale window.
 */
async function offrampMarkPending(id: string, previousStatus: string): Promise<void> {
  const next: OffRampStatus = 'pending_user_transfer_start';
  await offrampDb().query(
    `update off_ramp_sessions set status = $2, updated_at = now() - interval '2 minutes' where id = $1`,
    [id, next],
  );
  await offrampRecordEvent({
    sessionId: id,
    previousStatus: previousStatus as OffRampStatus,
    status: next,
    source: 'client',
    detail: { note: 'simulated missed webhook — reconciler will heal on next pass' },
    createdAt: new Date().toISOString(),
  });
}
import { verifyRampWebhook } from '../services/ramp.js';
import {
  verifyCarretWebhook,
  createSubAccount,
  getSubAccount,
  initiateKyc,
  submitKycDocument,
  uploadKycFile,
  getKycStatus,
  cleanupKyc,
  startDigilocker,
  fetchEaadhaarDetails,
  getConfiguredDepositAddress,
  createCryptoDeposit,
  whitelistWallet,
  registerBank,
  listBanks,
  listWalletBalances,
  type CarretKycStatusResponse,
} from '../services/carret.js';
import { carretLive } from '../config/env.js';
import {
  getMapping, getMappingByEmail, getMappingByPhone,
  upsertMapping, deleteMapping, updateKycStatus, markWalletWhitelisted,
} from '../services/carretSubAccountStore.js';
import { idempotency } from '../services/idempotency.js';
import {
  claimApproval,
  finishApproval,
  listPendingApprovals,
  needsSecondApproval,
  requestApproval,
  type ApprovalRecord,
} from '../services/approvals.js';
import { getRewards } from '../services/payoutHistory.js';
import { defaultChecks, runChecks, lastMonitorReport } from '../services/health.js';
import { recentAlerts, DEDUPE_WINDOW_MS } from '../services/alerts.js';
import { registerDevice, unregisterDevice } from '../services/push.js';
import { requireSession, requireRole, callerRole, identifyPartnerKey } from '../middleware/requireSession.js';
import { createPartnerKey, listPartnerKeys, revokePartnerKey } from '../services/partnerKeys.js';
import { callbackLimiter, sponsoredTxLimiter } from '../middleware/rateLimit.js';
import { allRemaining, CARRET_DAILY_LIMIT_INR } from '../services/carretLimits.js';
import multer from 'multer';
import {
  assignTierForDriver,
  getOnchainTier,
  getScoutConfig,
  revokeTier,
  scoreToTier,
  scoutCurrencyToml,
  scoutIssuerAddress,
} from '../stellar/scout.js';
import { getManagedWallet, provisionManagedWallet } from '../stellar/managed.js';
import { createPayoutBatch, listPayoutBatches, getPayoutBatch } from '../services/payouts.js';
import { listAttempts } from '../services/payoutAttempts.js';
import { quoteSwap, executeSwap } from '../routing/aggregator.js';
import { withSwapLock } from '../routing/swapLock.js';
import { listRoutableAssets } from '../routing/assets.js';
import { getTreasuryRoutingPlan, buildTreasuryConversion } from '../routing/treasury.js';

export const router = Router();

const VERSION = '0.1.0';
const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,7})?$/;
const RUPEE_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;

const userIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, 'userId contains unsupported characters')
  .refine((id) => !/^__.*__$/.test(id), 'userId is reserved');
const stellarAddressSchema = z
  .string()
  .refine((a) => StrKey.isValidEd25519PublicKey(a), 'address must be a Stellar public key');

const scoutTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const revokeScoutSchema = z.object({ address: z.string().refine((a) => StrKey.isValidEd25519PublicKey(a), 'address must be a Stellar public key') });
const createSettlementSchema = z.object({
  depositMemo: z.string().min(1).max(28).optional(),
  grossAmount: z.string().regex(AMOUNT_PATTERN, 'grossAmount must be a 7-decimal number'),
  asset: assetRefOptional(),
  drivers: z
    .array(z.object({ userId: userIdSchema, address: stellarAddressSchema, tier: scoutTierSchema.optional() }))
    .min(1)
    .max(500),
  depositTxHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'depositTxHash must be a 64-character transaction hash')
    .transform((h) => h.toLowerCase())
    .optional(),
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

router.get('/.well-known/stellar.toml', async (_req, res, next) => {
  try {
    const scoutIssuer = await scoutIssuerAddress();
    res.set('Access-Control-Allow-Origin', '*');
    res.type('text/plain').send(
      [
        'VERSION="2.0.0"',
        `NETWORK_PASSPHRASE="${env.networkPassphrase}"`,
        `HORIZON_URL="${env.horizonUrl}"`,
        `WEB_AUTH_ENDPOINT="https://${env.sep10.homeDomain}/v1/auth/challenge"`,
        `SIGNING_KEY="${serverSigningKey()}"`,
        ...(scoutIssuer ? [`ACCOUNTS=["${scoutIssuer}"]`] : []),
        '',
        '[DOCUMENTATION]',
        'ORG_NAME="PathPulse"',
        `ORG_URL="${env.webAppUrl}"`,
        ...(scoutIssuer ? scoutCurrencyToml(scoutIssuer) : []),
        '',
      ].join('\n'),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/health/ready', async (_req, res, next) => {
  try {
    const report = lastMonitorReport() ?? (await runChecks(defaultChecks()));
    if (!report.ok) logger.warn({ report }, 'readiness check failed');
    res.status(report.ok ? 200 : 503).json({
      ...report,
      checks: report.checks.map(({ name, ok, latencyMs }) => ({ name, ok, latencyMs })),
    });
  } catch (e) {
    next(e);
  }
});

const STARTED_AT = new Date().toISOString();

router.get('/v1/ops/status', requireRole('ops'), async (req, res, next) => {
  try {
    const report =
      req.query.refresh === 'true' ? await runChecks(defaultChecks()) : (lastMonitorReport() ?? (await runChecks(defaultChecks())));
    const body: OpsStatusResponse = {
      version: VERSION,
      startedAt: STARTED_AT,
      monitor: { intervalMs: env.alerts.healthIntervalMs, report: { ...report, network: env.network } },
      alerting: { webhookConfigured: !!env.alerts.webhookUrl, dedupeWindowMinutes: DEDUPE_WINDOW_MS / 60_000 },
      alerts: recentAlerts(),
    };
    res.json(body);
  } catch (e) {
    next(e);
  }
});

const partnerKeySchema = z.object({ name: z.string().min(1).max(80) });

router.post('/v1/ops/partner-keys', requireRole('ops'), async (req, res, next) => {
  try {
    const { name } = partnerKeySchema.parse(req.body);
    res.status(201).json(await createPartnerKey(name, getSessionFromRequest(req)!.userId));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/partner-keys', requireRole('ops'), async (_req, res, next) => {
  try {
    res.json({ items: await listPartnerKeys() });
  } catch (e) {
    next(e);
  }
});

router.delete('/v1/ops/partner-keys/:id', requireRole('ops'), async (req, res, next) => {
  try {
    if (!(await revokePartnerKey(req.params.id))) {
      res.status(404).json({ error: 'NotFound', message: `No active partner key ${req.params.id}` });
      return;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.get('/v1/gov/ledger', requireRole('partner', 'ops'), async (req, res, next) => {
  try {
    const s = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
    res.json({
      indexer: indexerStatus(),
      ...(await listLedger({ account: stellarAddressParam(s('account'), 'account'), cursor: cursorParam(req), limit: limitParam(req) })),
    });
  } catch (e) {
    next(e);
  }
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

/**
 * Expose the backend's current outbound IP so we can hand it to upstream
 * IP-whitelist operators (Carret in particular). App Runner's default
 * egress draws from an AWS NAT pool so this can rotate per request —
 * running it a few times tells you the pool size you're dealing with.
 * Not auth-gated: the result is public information the moment any
 * outbound request is made.
 */
router.get('/v1/ops/egress-ip', async (_req, res, next) => {
  try {
    const probes = ['https://api.ipify.org?format=json', 'https://ifconfig.me/all.json'];
    for (const url of probes) {
      try {
        const r = await fetchWithTimeout(url, {}, 5000);
        if (!r.ok) continue;
        const body = await r.json() as { ip?: string; ip_addr?: string };
        const ip = body.ip ?? body.ip_addr;
        if (ip) { res.json({ ip, source: url }); return; }
      } catch { /* try next */ }
    }
    res.status(502).json({ error: 'EgressProbeFailed', message: 'all ip probes failed' });
  } catch (e) { next(e); }
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
    if (typeof idToken !== 'string' || !idToken) {
      res.status(400).json({ error: 'ValidationError', message: 'idToken is required' });
      return;
    }
    const verified = await verifyGoogleIdToken(idToken).catch((err) => {
      logUpstream('google token verification failed', err);
      throw httpFail('Google sign-in could not be verified', 401, 'Unauthorized');
    });
    const { email, sub } = verified;
    const { userId, wallet } = await ensureAccountForEmail(email, sub);
    await replaceSession(req, res, { userId, method: 'google', email, address: wallet.address });
    const body: GoogleVerifyResponse = { userId, wallet };
    res.json(body);
  } catch (e) {
    if (!(e as { status?: number }).status) (e as { status?: number }).status = 401;
    next(e);
  }
});

router.get('/v1/auth/challenge', async (req, res, next) => {
  try {
    const account = stellarAddressParam(typeof req.query.account === 'string' ? req.query.account : undefined, 'account');
    if (!account) {
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
    if (typeof transaction !== 'string' || !transaction) {
      res.status(400).json({ error: 'ValidationError', message: 'transaction is required' });
      return;
    }
    const { userId, address } = await verifyChallenge(transaction).catch((err) => {
      logUpstream('wallet challenge verification failed', err);
      throw httpFail('Wallet challenge could not be verified', 401, 'Unauthorized');
    });
    await replaceSession(req, res, { userId, method: 'wallet', address });

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

async function autoWhitelistWallet(userId: string, address: string): Promise<void> {
  if (!carretLive) return;
  const mapping = await getMapping(userId);
  if (!mapping) return;
  if (mapping.walletWhitelistedAt) return;
  await whitelistWallet(mapping.carretAccountId, address);
  await markWalletWhitelisted(userId);
}

router.post('/v1/auth/guest', async (req, res, next) => {
  try {
    const userId = `guest_${randomUUID()}`;
    await replaceSession(req, res, { userId, method: 'guest' });
    const body: GuestSessionResponse = { userId };
    res.json(body);
  } catch (e) {
    next(e);
  }
});

function passcodeMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signedInIdentity(session: SessionPayload | null): string | null {
  if (!session) return null;
  if (session.method === 'google' && session.email) return session.email.toLowerCase();
  if (session.method === 'wallet' && session.address) return session.address;
  return null;
}

function operatorIdentity(session: SessionPayload): string | null {
  const identity = signedInIdentity(session);
  if (!identity) return null;
  if (env.opsOperators.length && !env.opsOperators.includes(identity)) return null;
  return identity;
}

function partnerIdentity(session: SessionPayload | null): string | null {
  const identity = signedInIdentity(session);
  if (!identity || !env.govPartners.includes(identity)) return null;
  return identity;
}

function lockedOut(res: Response): void {
  res.status(429).json({ error: 'LockedOut', message: 'too many failed passcode attempts — try again in 15 minutes' });
}

router.post('/v1/auth/partner/login', async (req, res, next) => {
  try {
    const { passcode } = req.body as { passcode?: string };
    if (!env.govPartnerPasscode) {
      res.status(500).json({ error: 'ConfigError', message: 'GOV_PARTNER_PASSCODE not configured' });
      return;
    }
    const existing = getSessionFromRequest(req);
    const individual = partnerIdentity(existing);
    if (env.govPartners.length && !individual) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'partner access needs a Google or wallet sign-in that is on the partner allowlist',
      });
      return;
    }
    const identity = individual ?? req.ip ?? 'unknown';
    if (isLockedOut('partner', identity)) {
      lockedOut(res);
      return;
    }
    if (typeof passcode !== 'string' || !passcodeMatches(passcode, env.govPartnerPasscode)) {
      recordFailure('partner', identity);
      res.status(401).json({ error: 'Unauthorized', message: 'invalid passcode' });
      return;
    }
    clearFailures('partner', identity);
    const session = withRole(existing ?? { userId: `partner_${randomUUID()}`, method: 'partner' }, 'partner');
    await replaceSession(req, res, session);
    const body: PartnerLoginResponse = { userId: session.userId };
    res.json(body);
  } catch (e) {
    next(e);
  }
});

router.post('/v1/auth/ops/login', async (req, res, next) => {
  try {
    const { passcode, totp } = req.body as { passcode?: string; totp?: string };
    if (!env.opsPasscode) {
      res.status(500).json({ error: 'ConfigError', message: 'OPS_PASSCODE not configured' });
      return;
    }
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'sign in before unlocking operator access' });
      return;
    }
    const identity = operatorIdentity(session);
    if (!identity) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'operator access needs a Google or wallet sign-in that is on the operator allowlist',
      });
      return;
    }
    const clientIp = req.ip ?? 'unknown';
    if (isLockedOut('ops', identity) || isLockedOut('ops-ip', clientIp)) {
      lockedOut(res);
      return;
    }
    if (typeof passcode !== 'string' || !passcodeMatches(passcode, env.opsPasscode)) {
      recordFailure('ops', identity);
      recordFailure('ops-ip', clientIp);
      res.status(401).json({ error: 'Unauthorized', message: 'invalid passcode' });
      return;
    }
    if (totpRequired(identity) && !(await verifyOperatorTotp(identity, totp))) {
      recordFailure('ops', identity);
      recordFailure('ops-ip', clientIp);
      res.status(401).json({ error: 'TotpRequired', message: 'a valid authenticator code is required' });
      return;
    }
    clearFailures('ops', identity);
    clearFailures('ops-ip', clientIp);
    await replaceSession(req, res, withRole(session, 'ops'));
    const body: OpsLoginResponse = { userId: session.userId };
    res.json(body);
  } catch (e) {
    next(e);
  }
});

router.post('/v1/auth/ops/exit', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.method === 'partner') await endSession(req, res);
    else await replaceSession(req, res, withRole(session, undefined));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/auth/me', (req, res) => {
  const session = getSessionFromRequest(req);
  const body: AuthMeResponse = {
    user: session
      ? {
          userId: session.userId,
          method: session.method,
          role: roleOf(session),
          email: session.email,
          address: session.address,
        }
      : null,
  };
  res.json(body);
});

const rewardsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

router.get('/v1/me/payouts', requireSession(), async (req, res, next) => {
  try {
    const { limit, cursor } = rewardsQuerySchema.parse(req.query);
    res.json(await getRewards(getSessionFromRequest(req)!, limit, cursor));
  } catch (e) {
    next(e);
  }
});

const pushDeviceSchema = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(['ios', 'android']),
});

router.post('/v1/me/devices', requireSession(), async (req, res, next) => {
  try {
    const { token, platform } = pushDeviceSchema.parse(req.body);
    await registerDevice(getSessionFromRequest(req)!.userId, token, platform);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.delete('/v1/me/devices/:token', requireSession(), async (req, res, next) => {
  try {
    await unregisterDevice(getSessionFromRequest(req)!.userId, req.params.token);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.post('/v1/auth/logout', async (req, res, next) => {
  try {
    await endSession(req, res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/v1/tx/build', sponsoredTxLimiter, async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized', message: 'sign in first' });
      return;
    }
    const parsed = buildTxSchema.parse(req.body);
    res.json(await buildTransaction(session.userId, parsed));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/tx/submit', requireSession(), async (req, res, next) => {
  try {
    const { xdr } = submitTxSchema.parse(req.body);
    res.json(await submitTransaction(xdr));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/settlement/batches', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const parsed = createSettlementSchema.parse(req.body);
    const operator = getSessionFromRequest(req)!.userId;
    if (needsSecondApproval(parsed.grossAmount)) {
      res.status(202).json(await requestApproval('settlement', parsed, parsed.grossAmount, operator));
      return;
    }
    res.json(await executeSettlementBatch(parsed, { createdBy: operator }));
  } catch (e) {
    next(e);
  }
});

function visibleBatch(batch: SettlementBatch, req: Request): SettlementBatch {
  const session = getSessionFromRequest(req);
  if (callerRole(req)) return batch;
  return {
    ...batch,
    createdBy: undefined,
    driverPayouts: (batch.driverPayouts ?? []).map((p) =>
      p.userId === session?.userId ? p : { ...p, userId: 'redacted' },
    ),
  };
}

const createConvertedSettlementSchema = z.object({
  from: z.string().min(1),
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a 7-decimal number'),
  drivers: z
    .array(z.object({ userId: userIdSchema, address: stellarAddressSchema }))
    .min(1)
    .max(500),
});

router.post('/v1/settlement/converted', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const parsed = createConvertedSettlementSchema.parse(req.body);
    const operator = getSessionFromRequest(req)!.userId;
    if (needsSecondApproval(parsed.amount)) {
      res.status(202).json(await requestApproval('converted_settlement', parsed, parsed.amount, operator));
      return;
    }
    res.json(await executeConvertedSettlement(parsed, { createdBy: operator }));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches', identifyPartnerKey(), async (req, res, next) => {
  try {
    const page = await listSettlementBatches({
      cursor: cursorParam(req),
      limit: limitParam(req),
      ...batchFilters(req),
    });
    res.json({ ...page, items: page.items.map((b) => visibleBatch(b, req)) });
  } catch (e) {
    next(e);
  }
});

async function collectBatches(req: Request): Promise<SettlementBatch[]> {
  const { since, until } = exportRange(req);
  const filters = { ...batchFilters(req), since, until };
  const items: SettlementBatch[] = [];
  let cursor: string | null | undefined = undefined;
  for (let i = 0; i < 20; i++) {
    const page: SettlementBatchPage = await listSettlementBatches({
      cursor: cursor ?? undefined,
      limit: 100,
      ...filters,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items;
}

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pathpulse-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
}

router.get('/v1/settlement/batches/export.csv', requireRole('partner', 'ops'), async (req, res, next) => {
  try {
    sendCsv(res, 'settlements', batchesToCsv(await collectBatches(req)));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches/payouts.csv', requireRole('partner', 'ops'), async (req, res, next) => {
  try {
    sendCsv(res, 'driver-payouts', payoutsToCsv(await attachStoredPayoutHashes(await collectBatches(req))));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/batches/:id/receipt.pdf', requireRole('partner', 'ops'), async (req, res, next) => {
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

router.get('/v1/settlement/batches/:id', identifyPartnerKey(), async (req, res, next) => {
  try {
    res.json(visibleBatch(await getSettlementBatchWithPayouts(req.params.id), req));
  } catch (e) {
    next(e);
  }
});

const groupPayoutRecipientSchema = z.object({
  name: z.string().min(1),
  address: z.string().refine((a) => StrKey.isValidEd25519PublicKey(a), 'address must be a Stellar public key'),
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a 7-decimal number'),
  remark: z.string().max(120).optional(),
});
const createGroupPayoutSchema = z.object({
  asset: assetRefOptional(),
  memo: z.string().max(28, 'memo must be 28 characters or fewer').optional(),
  recipients: z.array(groupPayoutRecipientSchema).min(1).max(100),
});

function groupPayoutTotal(recipients: { amount: string }[]): string {
  return fromStroops(recipients.reduce((sum, r) => sum + toStroops(r.amount), 0n));
}

router.post('/v1/settlement/group-payouts', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const parsed = createGroupPayoutSchema.parse(req.body);
    const operator = getSessionFromRequest(req)!.userId;
    const total = groupPayoutTotal(parsed.recipients);
    if (needsSecondApproval(total)) {
      res.status(202).json(await requestApproval('group_payout', parsed, total, operator));
      return;
    }
    res.json(await executeGroupPayout(parsed, { createdBy: operator }));
  } catch (e) {
    next(e);
  }
});

async function runApproved(approval: ApprovalRecord, approver: string): Promise<unknown> {
  switch (approval.action) {
    case 'settlement':
      return executeSettlementBatch(createSettlementSchema.parse(approval.requestBody), {
        createdBy: approval.requestedBy,
        approvedBy: approver,
      });
    case 'converted_settlement':
      return executeConvertedSettlement(createConvertedSettlementSchema.parse(approval.requestBody), {
        createdBy: approval.requestedBy,
        approvedBy: approver,
      });
    case 'group_payout':
      return executeGroupPayout(createGroupPayoutSchema.parse(approval.requestBody), {
        createdBy: approval.requestedBy,
      });
  }
}

router.get('/v1/ops/approvals', requireRole('ops'), async (_req, res, next) => {
  try {
    res.json({ items: await listPendingApprovals() });
  } catch (e) {
    next(e);
  }
});

router.post('/v1/ops/approvals/:id/approve', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const approver = getSessionFromRequest(req)!.userId;
    const approval = await claimApproval(req.params.id, approver);
    try {
      const result = await runApproved(approval, approver);
      await finishApproval(approval.id, 'executed', { id: (result as { id?: string })?.id ?? null });
      res.json(result);
    } catch (e) {
      await finishApproval(approval.id, 'failed', { error: (e as Error).name });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

function visibleGroupBatch(batch: GroupPayoutBatch, req: Request): GroupPayoutBatch {
  if (callerRole(req) === 'ops') return batch;
  return {
    ...batch,
    createdBy: undefined,
    receipts: batch.receipts.map((r) => ({ ...r, name: 'redacted' })),
  };
}

router.get('/v1/settlement/group-payouts', requireRole('partner', 'ops'), async (req, res, next) => {
  try {
    const cursor = cursorParam(req);
    const limit = limitParam(req);
    const page = await listGroupPayoutBatches(cursor, limit);
    res.json({ ...page, items: page.items.map((b) => visibleGroupBatch(b, req)) });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/settlement/group-payouts/:id', requireRole('partner', 'ops'), async (req, res, next) => {
  try {
    res.json(visibleGroupBatch(await getGroupPayoutBatch(req.params.id), req));
  } catch (e) {
    next(e);
  }
});

const createPayoutBatchSchema = z.object({ settlementBatchId: z.string().min(1) });

router.post('/v1/ops/payouts/batches', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const { settlementBatchId } = createPayoutBatchSchema.parse(req.body);
    const settlementBatch = await getSettlementBatch(settlementBatchId);
    if (settlementBatch.status && settlementBatch.status !== 'confirmed') {
      throw httpFail(`Settlement batch ${settlementBatchId} is ${settlementBatch.status}, not confirmed on-chain`, 409, 'SettlementNotConfirmed');
    }
    res.json(
      await createPayoutBatch(settlementBatch.driverPayouts, settlementBatch.asset, {
        settlementBatchId,
        createdBy: getSessionFromRequest(req)!.userId,
      }),
    );
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/payouts/batches', requireRole('ops'), async (req, res, next) => {
  try {
    const cursor = cursorParam(req);
    const limit = limitParam(req);
    res.json(await listPayoutBatches(cursor, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/payouts/batches/:id', requireRole('ops', 'partner'), async (req, res, next) => {
  try {
    res.json(await getPayoutBatch(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/payouts/batches/:id/attempts', requireRole('ops'), async (req, res, next) => {
  try {
    res.json({ batchId: req.params.id, attempts: await listAttempts(req.params.id) });
  } catch (e) {
    next(e);
  }
});

const createWithdrawalSchema = z.object({
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a 7-decimal number'),
  asset: assetRefOptional(),
  fiatCurrency: z.string().optional(),
  settlementBatchId: z.string().min(1, 'settlementBatchId is required'),
});

const QUOTE_CACHE_MS = 30_000;
const quoteCache = new Map<string, { at: number; quote: Promise<unknown> }>();

function cachedQuote(amount: string): Promise<unknown> {
  const now = Date.now();
  for (const [k, v] of quoteCache) if (now - v.at > QUOTE_CACHE_MS) quoteCache.delete(k);
  const hit = quoteCache.get(amount);
  if (hit) return hit.quote;
  const quote = quoteWithdrawal(amount);
  quoteCache.set(amount, { at: now, quote });
  quote.catch(() => quoteCache.delete(amount));
  return quote;
}

router.get('/v1/offramp/quotes', requireSession(), async (req, res, next) => {
  try {
    const amount = typeof req.query.amount === 'string' ? req.query.amount : '';
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      const e = new Error('amount must be a positive 7-decimal number') as Error & { status: number };
      e.name = 'ValidationError';
      e.status = 400;
      throw e;
    }
    res.json(await cachedQuote(fromStroops(toStroops(amount))));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/offramp/sessions', requireSession(), idempotency(), async (req, res, next) => {
  try {
    const parsed = createWithdrawalSchema.parse(req.body);
    const session = getSessionFromRequest(req)!;
    const userIp = req.ip || undefined;
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
    const cursor = cursorParam(req);
    const limit = limitParam(req);
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

// Fiat on-ramp (INR → USDC on Carret): mirrors the off-ramp trio.
const createDepositSchema = z.object({
  amount: z.string().regex(RUPEE_PATTERN, 'amount must be a rupee amount (up to 2 decimals)'),
});

router.get('/v1/onramp/quotes', requireSession(), async (req, res, next) => {
  try {
    const amount = typeof req.query.amount === 'string' ? req.query.amount : '';
    if (!RUPEE_PATTERN.test(amount) || Number(amount) <= 0) {
      const e = new Error('amount must be a positive rupee amount') as Error & { status: number };
      e.name = 'ValidationError'; e.status = 400; throw e;
    }
    res.json(await onrampGetQuote(amount));
  } catch (e) { next(e); }
});

router.post('/v1/onramp/sessions', requireSession(), idempotency(), async (req, res, next) => {
  try {
    const parsed = createDepositSchema.parse(req.body);
    const session = getSessionFromRequest(req)!;
    res.json(await onrampCreateDeposit(session.userId, parsed));
  } catch (e) { next(e); }
});

router.get('/v1/onramp/sessions', requireSession(), async (req, res, next) => {
  try {
    const limit = limitParam(req);
    res.json(onrampListSessions(getSessionFromRequest(req)!.userId, limit));
  } catch (e) { next(e); }
});

router.get('/v1/onramp/sessions/:id', requireSession(), async (req, res, next) => {
  try {
    res.json(await onrampGetSession(req.params.id, getSessionFromRequest(req)!.userId));
  } catch (e) { next(e); }
});

// ── D4 / T2 driver-facing dev handles ──────────────────────────────────
// Session-authed variants (driver can inspect/trigger against their own
// session only) so the Tranche 2 recording works without ops credentials.
// Upstream's ops-scoped variants below handle the operator case.

router.get('/v1/offramp/sessions/:id/events', requireSession(), async (req, res, next) => {
  try {
    const userId = getSessionFromRequest(req)!.userId;
    const session = await getWithdrawal(req.params.id, userId);
    res.json({
      // Nested `session` object — the web dashboard reads data.session.status
      // / .provider / .settlementBatchId; flattening those into siblings makes
      // the UI crash with "Cannot read properties of undefined (reading
      // 'status')" the moment a driver opens the Off-ramp page.
      session: {
        id: session.id,
        status: session.status,
        provider: session.provider,
        settlementBatchId: session.settlementBatchId ?? null,
      },
      events: await listEvents(session.id),
    });
  } catch (e) { next(e); }
});

router.post('/v1/ops/offramp/reconcile-once', requireRole('ops'), async (_req, res, next) => {
  try {
    res.json(await reconcileOnce());
  } catch (e) { next(e); }
});

/**
 * D4 / T2 demo helper — simulate a lost webhook on the caller's own
 * session. Rolls status back to pending_user_transfer_start and writes
 * a `client` event. The next reconciler pass sees Carret's real
 * `filled` status and writes a `reconciler` event healing it back.
 */
if (env.network !== 'mainnet') {
  router.post('/v1/ops/offramp/sessions/:id/simulate-missed-webhook', requireRole('ops'), async (req, res, next) => {
    try {
      const userId = getSessionFromRequest(req)!.userId;
      const s = await getWithdrawal(req.params.id, userId);
      await offrampMarkPending(s.id, s.status);
      res.json({ ok: true, sessionId: s.id, rolledTo: 'pending_user_transfer_start' });
    } catch (e) { next(e); }
  });
}

router.get('/v1/ops/offramp/sessions', requireRole('ops'), async (req, res, next) => {
  try {
    const limit = limitParam(req);
    res.json({ items: await listAllSessions(limit) });
  } catch (e) { next(e); }
});

router.get('/v1/ops/offramp/sessions/:id/events', requireRole('ops'), async (req, res, next) => {
  try {
    const events = await listEvents(req.params.id);
    if (!events.length) {
      const known = (await listAllSessions(500)).some((s) => s.id === req.params.id);
      if (!known) throw notFound(`Off-ramp session ${req.params.id} not found`);
    }
    res.json({ sessionId: req.params.id, events });
  } catch (e) { next(e); }
});

router.post('/v1/ops/offramp/reconcile', requireRole('ops'), async (_req, res, next) => {
  try {
    res.json(await reconcileOnce());
  } catch (e) { next(e); }
});

const routableSchema = z.string().min(1);
const amountSchema = z.string().regex(AMOUNT_PATTERN, 'amount must be a 7-decimal number');
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

router.post('/v1/routing/swap', requireRole('ops'), idempotency(), async (req, res, next) => {
  try {
    const { from, to, amount } = routingSwapSchema.parse(req.body);
    res.status(201).json(await withSwapLock(() => executeSwap(from, to, amount)));
  } catch (e) {
    next(e);
  }
});

router.get('/v1/routing/treasury/plan', requireRole('partner', 'ops'), async (_req, res, next) => {
  try {
    res.json(await getTreasuryRoutingPlan());
  } catch (e) {
    next(e);
  }
});

const treasuryConversionSchema = z.object({
  from: z.string().min(1).max(12),
  amount: z.string().regex(AMOUNT_PATTERN, 'amount must be a 7-decimal number'),
});

router.post('/v1/routing/treasury/conversions', requireRole('ops'), async (req, res, next) => {
  try {
    const { from, amount } = treasuryConversionSchema.parse(req.body);
    res.json(await buildTreasuryConversion(from, amount));
  } catch (e) {
    next(e);
  }
});

const assignScoutSchema = z.object({ driverId: userIdSchema }).strict();

router.get('/v1/scout', async (_req, res, next) => {
  try {
    res.json(await getScoutConfig());
  } catch (e) {
    next(e);
  }
});

router.post('/v1/scout/assign', requireRole('ops'), async (req, res, next) => {
  try {
    const { driverId } = assignScoutSchema.parse(req.body);
    res.json(await assignTierForDriver(driverId));
  } catch (e) {
    next(e);
  }
});

function httpFail(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}
const validationError = (m: string) => httpFail(m, 400, 'ValidationError');
const notFound = (m: string) => httpFail(m, 404, 'NotFound');

const scoreImportSchema = z.object({
  supplier: z.string().min(1, 'supplier is required — name who delivered these scores'),
  sourceRef: z.string().optional(),
  notes: z.string().optional(),
  receivedAt: z.string().optional(),
  scores: z.array(z.unknown()).optional(),
  csv: z.string().optional(),
});

router.post('/v1/ops/scores/import', requireRole('ops'), async (req, res, next) => {
  try {
    const body = scoreImportSchema.parse(req.body);
    if (!body.scores && !body.csv) {
      throw validationError('provide either scores[] or csv');
    }
    if (body.scores && body.csv) {
      throw validationError('provide scores[] or csv, not both');
    }

    const rows = body.csv ? parseScoreCsv(body.csv) : body.scores;
    const { scores } = validateScoreBatch(rows);

    const raw = (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const record = await saveImport(
      {
        supplier: body.supplier,
        sourceRef: body.sourceRef,
        notes: body.notes,
        importedBy: getSessionFromRequest(req)!.userId,
        receivedAt: body.receivedAt ?? new Date().toISOString(),
        payloadSha256: hashPayload(raw),
      },
      scores,
    );

    res.json({ import: record, scores: await listScores(record.id) });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/scores/imports', requireRole('ops'), async (req, res, next) => {
  try {
    const limit = limitParam(req);
    res.json({ items: await listImports(limit) });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/ops/scores/imports/:id', requireRole('ops'), async (req, res, next) => {
  try {
    const record = await getImport(req.params.id);
    if (!record) throw notFound(`Score import ${req.params.id} not found`);
    res.json({ import: record, scores: await listScores(record.id) });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/scout/feed', requireRole('ops'), async (_req, res, next) => {
  try {
    const imports = await listImports(1);
    res.json({
      pulseGenLive: pulseGenLive(),
      endpointHost: pulseGenEndpointHost(),
      mode: pulseGenLive() ? 'pulsegen-live' : imports.length ? 'pulsegen-batch' : 'derived',
      scoredDrivers: await countScores(),
      latestImport: imports[0] ?? null,
      scores: await listLatestScores(100),
      assignments: await latestAssignments(100),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/v1/scout/score/:driverId', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    if (req.params.driverId !== session.userId && roleOf(session) !== 'ops') {
      throw httpFail('You can read only your own validation score', 403, 'Forbidden');
    }
    res.json(await resolveScore(req.params.driverId));
  } catch (e) {
    next(e);
  }
});

const demoDriversSchema = z.object({
  driverIds: z.array(userIdSchema).min(1).max(10).optional(),
});

const DEFAULT_DEMO_DRIVERS = [
  'drv-pulsegen-demo-002',
  'drv-pulsegen-demo-003',
  'drv-pulsegen-demo-006',
];

if (env.network !== 'mainnet') {
  router.post('/v1/ops/demo/scout-drivers', requireRole('ops'), async (req, res, next) => {
    try {
      const { driverIds } = demoDriversSchema.parse(req.body ?? {});
      const ids = driverIds ?? DEFAULT_DEMO_DRIVERS;
      const drivers = [];

      for (const driverId of ids) {
        const wallet = (await getManagedWallet(driverId)) ?? (await provisionManagedWallet(driverId));
        const validation = await resolveScore(driverId);
        const expected = scoreToTier(validation.score);
        const current = await getOnchainTier(wallet.address);

        let assignmentTx: string | null = null;
        let assignedNow = false;
        if (current.tier !== expected) {
          assignmentTx = (await assignTierForDriver(driverId)).txHash;
          assignedNow = true;
        } else {
          const prior = (await latestAssignments(500)).find((a) => a.driverId === driverId);
          assignmentTx = prior?.txHash ?? null;
        }

        const onchain = await getOnchainTier(wallet.address);
        drivers.push({
          userId: driverId,
          address: wallet.address,
          score: validation.score,
          scoredAt: validation.scoredAt,
          scoreSource: validation.source,
          scoreImportId: validation.importId ?? null,
          tier: onchain.tier,
          multiplier: onchain.multiplier,
          assignmentTx,
          assignedNow,
        });
      }

      res.json({ drivers });
    } catch (e) {
      next(e);
    }
  });
}

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
    const address = stellarAddressParam(req.params.address) as string;
    const { tier, multiplier } = await getOnchainTier(address);
    res.json({ address, tier, multiplier });
  } catch (e) {
    next(e);
  }
});

router.post('/v1/offramp/callback', callbackLimiter, async (req, res, next) => {
  try {
    const raw = (req as typeof req & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

    if (activeProvider() === 'carret') {
      const signature = (req.headers['x-carret-signature'] as string) ?? '';
      if (!verifyCarretWebhook(raw, signature)) {
        res.status(401).json({ error: 'InvalidSignature', message: 'webhook signature verification failed' });
        return;
      }
      if (await isReplay('carret', raw)) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      const body = req.body as {
        order_id?: string;
        status?: string;
        data?: { order_id?: string; status?: string };
      };
      const orderId = body.order_id ?? body.data?.order_id;
      const status = body.status ?? body.data?.status;
      if (orderId && status) await applyCarretCallback(orderId, status);
      res.status(200).json({ ok: true });
      return;
    }

    const signature = (req.headers['x-body-signature'] as string) ?? '';
    if (!verifyRampWebhook(raw, signature)) {
      res.status(401).json({ error: 'InvalidSignature', message: 'webhook signature verification failed' });
      return;
    }
    if (await isReplay('ramp', raw)) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
    const body = req.body as { type?: string; status?: string; payload?: { status?: string } };
    const status = body.type ?? body.status ?? body.payload?.status;
    if (ref && status) await applyCallback(ref, status);
    res.status(200).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export const KYC_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf', 'application/xml', 'text/xml']);

const kycUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (KYC_UPLOAD_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(httpFail(`Unsupported file type ${file.mimetype}; upload JPEG, PNG, PDF or XML`, 415, 'UnsupportedMediaType'));
  },
});

const createSubAccountSchema = z.object({
  email: z.string().email(),
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

router.post('/v1/carret/provision-subaccount', async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized', message: 'session required' });
      return;
    }

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

    const verifiedEmail = session.method === 'google' ? session.email?.trim().toLowerCase() : undefined;
    if (!verifiedEmail || verifiedEmail !== parsed.email.trim().toLowerCase()) {
      res.status(403).json({
        error: 'EmailNotVerified',
        message: 'KYC must use the email of your Google sign-in',
      });
      return;
    }
    const byEmail = await getMappingByEmail(parsed.email);
    if (byEmail) {
      const adopted = await upsertMapping({
        userId: session.userId,
        carretAccountId: byEmail.carretAccountId,
        referenceId: byEmail.referenceId,
        kycStatus: byEmail.kycStatus,
        walletWhitelistedAt: byEmail.walletWhitelistedAt,
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
    if (await getMappingByPhone(parsed.phone_number)) {
      res.status(409).json({
        error: 'CarretAccountExists',
        message: 'This email or phone is already registered. Sign in with Google using that email to resume.',
      });
      return;
    }

    const account = await createSubAccount({
      ...parsed,
      is_email_verified: true,
      user_ip_address: req.ip ?? '0.0.0.0',
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

    let effectiveStatus = mapping.kycStatus;
    try {
      const acc = await getSubAccount(mapping.carretAccountId);
      if (acc?.kyc_status && acc.kyc_status !== mapping.kycStatus) {
        effectiveStatus = acc.kyc_status as typeof mapping.kycStatus;
      }
      if (effectiveStatus === 'manual_review' || effectiveStatus === 'rejected') {
        try {
          const kyc = await getKycStatus(mapping.carretAccountId);
          const info = (kyc as unknown as { kyc_info?: CarretKycStatusResponse }).kyc_info ?? kyc;
          const freshSessionPending =
            info?.kyc_status === 'pending' &&
            Array.isArray(info?.ovd_documents) &&
            info.ovd_documents.length === 0;
          if (freshSessionPending) effectiveStatus = 'pending';
        } catch { }
      }
      if (effectiveStatus !== mapping.kycStatus) {
        await updateKycStatus(session.userId, effectiveStatus).catch(() => {});
      }
    } catch {}

    res.json({
      carretAccountId: mapping.carretAccountId,
      kycStatus: effectiveStatus,
      email: mapping.email,
      referenceId: mapping.referenceId,
    });
  } catch (e) {
    next(e);
  }
});

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
    try { await cleanupKyc(mapping.carretAccountId); } catch {}
    await deleteMapping(session.userId);
    res.json({ cleared: true, wasAccountId: mapping.carretAccountId });
  } catch (e) {
    next(e);
  }
});

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

const initiateKycSchema = z.object({ account_id: z.union([z.number(), z.string()]) });
const carretAccountIdParam = z.string().regex(/^\d{1,20}$/, 'accountId must be digits only');

async function ownCarretAccount(userId: string, claimed?: string | number): Promise<string> {
  const mapping = await getMapping(userId);
  if (!mapping) throw httpFail('Provision your Carret sub-account first', 422, 'NoMapping');
  if (claimed !== undefined && String(claimed) !== mapping.carretAccountId) {
    throw httpFail('That Carret account does not belong to this session', 403, 'Forbidden');
  }
  return mapping.carretAccountId;
}

async function assertOwnKycSession(userId: string, kycSessionId: string): Promise<void> {
  const status = await getKycStatus(await ownCarretAccount(userId));
  const info = (status as unknown as { kyc_info?: CarretKycStatusResponse }).kyc_info ?? status;
  if (!info.kyc_session || String(info.kyc_session) !== kycSessionId) {
    throw httpFail('That KYC session does not belong to this session', 403, 'Forbidden');
  }
}

router.post('/v1/carret/kyc/initiate', requireSession(), async (req, res, next) => {
  try {
    const account_id = await ownCarretAccount(
      getSessionFromRequest(req)!.userId,
      initiateKycSchema.parse(req.body).account_id,
    );
    try {
      res.json(await initiateKyc(account_id));
    } catch (e) {
      const msg = String((e as Error).message ?? '').toLowerCase();
      const status = (e as { status?: number }).status;
      const looksLikeDuplicate = status === 422 && msg.includes('already exists');
      if (!looksLikeDuplicate) throw e;
      const status_ = await getKycStatus(account_id);
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
    await assertOwnKycSession(getSessionFromRequest(req)!.userId, kyc_session_id);
    res.json(await submitKycDocument({ kycSessionId: kyc_session_id, document }));
  } catch (e) {
    next(e);
  }
});

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
      await assertOwnKycSession(getSessionFromRequest(req)!.userId, kyc_session);
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
    res.json(await getKycStatus(await ownCarretAccount(getSessionFromRequest(req)!.userId, carretAccountIdParam.parse(req.params.accountId))));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/carret/kyc/cleanup', requireSession(), async (req, res, next) => {
  try {
    const { account_id } = initiateKycSchema.parse(req.body);
    res.json(await cleanupKyc(await ownCarretAccount(getSessionFromRequest(req)!.userId, account_id)));
  } catch (e) {
    next(e);
  }
});

router.post('/v1/carret/kyc/digilocker/start', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(422).json({ error: 'NoMapping', message: 'Provision a Carret sub-account first' });
      return;
    }
    const referenceId = `pp-${session.userId.slice(0, 8)}-${Date.now().toString(36)}`;
    const r = await startDigilocker(referenceId);
    res.json({ reference_id: referenceId, url: r.data.url });
  } catch (e) {
    next(e);
  }
});

const digilockerFinishSchema = z.object({
  reference_id: z.string().min(1),
  kyc_session_id: z.string().min(1),
});

router.post('/v1/carret/kyc/digilocker/finish', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(422).json({ error: 'NoMapping', message: 'Provision a Carret sub-account first' });
      return;
    }
    const { reference_id, kyc_session_id } = digilockerFinishSchema.parse(req.body);
    const details = await fetchEaadhaarDetails(reference_id);
    const xmlUrl = details.data.xmlAadhaarFile;
    const xmlRes = await fetchWithTimeout(xmlUrl);
    if (!xmlRes.ok) {
      throw new Error(`XML presigned-url download failed: ${xmlRes.status}`);
    }
    const buf = Buffer.from(await xmlRes.arrayBuffer());
    const magic = buf.slice(0, 8).toString('hex');
    const upstreamContentType = xmlRes.headers.get('content-type');
    logger.info(
      {
        kyc_session_id,
        reference_id,
        xmlUrlHost: new URL(xmlUrl).host,
        byteLength: buf.length,
        magicHex: magic,
        upstreamContentType,
        snippet: buf.slice(0, 120).toString('utf8'),
      },
      'digilocker eAadhaar file downloaded, submitting to Carret',
    );
    await uploadKycFile({
      kycSessionId: kyc_session_id,
      docType: 'aadhaar',
      fileType: 'xml',
      filename: 'aadhaar.xml',
      fileBuffer: buf,
      contentType: 'application/xml',
    });
    res.json({
      success: true,
      aadhaar_name: details.data.name,
      masked_aadhaar: details.data.maskedAadhaarNumber,
    });
  } catch (e) {
    next(e);
  }
});

const registerBankSchema = z.object({
  bank_account_no: z.string().regex(/^\d{9,18}$/, 'account number must be 9-18 digits'),
  bank_ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC must be 11 chars, e.g. HDFC0001234'),
  bank_account_name: z.string().min(1).max(120),
  bank_name: z.string().min(1).max(120),
});

router.get('/v1/carret/banks', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const mapping = await getMapping(session.userId);
    if (!mapping) { res.json({ items: [] }); return; }
    const banks = await listBanks(mapping.carretAccountId);
    res.json({ items: banks });
  } catch (e) { next(e); }
});

router.get('/v1/carret/wallets', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const mapping = await getMapping(session.userId);
    if (!mapping) { res.json({ items: [] }); return; }
    const items = await listWalletBalances(mapping.carretAccountId);
    res.json({ items });
  } catch (e) { next(e); }
});

/**
 * Return Carret's configured deposit address + memo for the active corridor.
 * Used by the ops smoke-test flow to pre-fund the trading wallet before placing
 * an off-ramp order, because Carret validates the trading-wallet balance
 * upfront and will reject /place_order/ with "Insufficient USDC" otherwise.
 */
router.get('/v1/carret/deposit-address', requireSession(), async (_req, res, next) => {
  try {
    const d = await getConfiguredDepositAddress();
    res.json({ id: d.id, address: d.address, memo: d.memo_label, chain: d.chain, asset: d.asset });
  } catch (e) { next(e); }
});

/**
 * Full crypto-deposit flow: broadcast Stellar USDC from the caller's managed
 * wallet to Carret's deposit address, then register the deposit with Carret so
 * their reconciler credits the trading wallet. Without the /crypto_deposit/
 * registration a raw on-chain transfer sits uncredited (Carret's Travel Rule
 * compliance). Only hashes this backend broadcast are ever registered.
 */
const depositSchema = z.object({ amount: z.string().regex(AMOUNT_PATTERN) }).strict();
router.post('/v1/carret/deposit', requireSession(), idempotency(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const { amount } = depositSchema.parse(req.body);
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(422).json({ error: 'NoMapping', message: 'Provision a Carret sub-account first' });
      return;
    }
    const d = await getConfiguredDepositAddress();
    const txHash = await sendCarretDeposit(session.userId, d.address, d.memo_label, amount);
    try {
      const deposit = await createCryptoDeposit({
        accountId: mapping.carretAccountId,
        carretWalletId: d.id,
        asset: d.asset,
        chain: d.chain,
        amount,
        txnId: txHash,
      });
      res.json({ txHash, destination: d.address, memo: d.memo_label, amount, deposit });
    } catch (e) {
      logUpstream('carret deposit registration failed', e);
      const failure = httpFail(
        `Deposit ${txHash} was sent but Carret did not register it; an operator will retry the registration.`,
        502,
        'CarretDepositUnregistered',
      ) as Error & { keepIdempotencyKey: boolean };
      failure.keepIdempotencyKey = true;
      throw failure;
    }
  } catch (e) { next(e); }
});

router.post('/v1/ops/offramp/sessions/:id/register-deposit', requireRole('ops'), async (req, res, next) => {
  try {
    res.json(await retryDepositRegistration(req.params.id));
  } catch (e) { next(e); }
});

router.post('/v1/carret/banks', requireSession(), async (req, res, next) => {
  try {
    const session = getSessionFromRequest(req)!;
    const mapping = await getMapping(session.userId);
    if (!mapping) {
      res.status(422).json({ error: 'NoMapping', message: 'Provision your Carret sub-account first' });
      return;
    }
    const parsed = registerBankSchema.parse(req.body);
    const bank = await registerBank({
      accountId: mapping.carretAccountId,
      bankAccountNo: parsed.bank_account_no,
      bankIfsc: parsed.bank_ifsc.toUpperCase(),
      bankAccountName: parsed.bank_account_name,
      bankName: parsed.bank_name,
    });
    res.json(bank);
  } catch (e) { next(e); }
});
