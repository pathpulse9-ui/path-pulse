import { initSentry } from './observability/sentry.js';
initSentry();

import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { migrate } from './db/client.js';
import { loadRevokedSessions } from './services/session.js';
import { startOrphanReconciler } from './services/orphanReconciler.js';
import { sweepExpiredKeys } from './services/idempotency.js';
import { sweepRateLimits } from './middleware/rateLimit.js';
import { startHealthMonitor } from './services/health.js';
import { startChainIndexer } from './services/chainIndexer.js';
import { startScoutReview } from './services/scoutReview.js';
import { reconcileSubmittedBatches } from './stellar/settlement.js';
import { countLegacySeeds, resealLegacySeeds } from './stellar/managed.js';

const app = createServer();

await migrate();
await loadRevokedSessions();
if (env.nodeEnv === 'production') {
  await resealLegacySeeds();
} else if (await countLegacySeeds()) {
  logger.warn('managed wallets still hold unbound v1 seals — run `pnpm tsx scripts/reseal-seeds.ts` against this database');
}

const reconcileSettlements = () =>
  reconcileSubmittedBatches().catch((e) => logger.error({ err: e }, 'settlement reconcile failed'));
await reconcileSettlements();
if (env.settlementReconcile.intervalMs > 0) {
  setInterval(reconcileSettlements, env.settlementReconcile.intervalMs).unref?.();
}

startOrphanReconciler();

setInterval(() => {
  sweepExpiredKeys().catch((e) => logger.warn({ err: e }, 'idempotency sweep failed'));
  sweepRateLimits().catch((e) => logger.warn({ err: e }, 'rate limit sweep failed'));
}, 60 * 60 * 1000).unref?.();

startHealthMonitor();

startChainIndexer();

startScoutReview();

app.listen(env.port, '0.0.0.0', () => {
  logger.info(
    { port: env.port, network: env.network, horizon: env.horizonUrl },
    `PathPulse Backend Core listening on :${env.port}`,
  );
});
