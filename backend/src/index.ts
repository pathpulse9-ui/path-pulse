import { initSentry } from './observability/sentry.js';
initSentry();

import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { migrate } from './db/client.js';
import { loadRevokedSessions } from './services/session.js';
import { startOrphanReconciler } from './services/orphanReconciler.js';
import { sweepExpiredKeys } from './services/idempotency.js';
import { startHealthMonitor } from './services/health.js';
import { startChainIndexer } from './services/chainIndexer.js';

const app = createServer();

await migrate();
await loadRevokedSessions();

startOrphanReconciler();

setInterval(() => {
  sweepExpiredKeys().catch((e) => logger.warn({ err: e }, 'idempotency sweep failed'));
}, 60 * 60 * 1000).unref?.();

startHealthMonitor();

startChainIndexer();

app.listen(env.port, '0.0.0.0', () => {
  logger.info(
    { port: env.port, network: env.network, horizon: env.horizonUrl },
    `PathPulse Backend Core listening on :${env.port}`,
  );
});
