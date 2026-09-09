import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { migrate } from './db/client.js';
import { startOrphanReconciler } from './services/orphanReconciler.js';
import { sweepExpiredKeys } from './services/idempotency.js';

const app = createServer();

await migrate();

// PAT-78: background reconciler for orphaned Carret orders. No-op unless
// DATABASE_URL is set and Carret credentials are configured.
startOrphanReconciler();

// PAT-77: hourly sweep of expired idempotency keys (24h TTL).
setInterval(() => {
  sweepExpiredKeys().catch((e) => logger.warn({ err: e }, 'idempotency sweep failed'));
}, 60 * 60 * 1000).unref?.();

app.listen(env.port, '0.0.0.0', () => {
  logger.info(
    { port: env.port, network: env.network, horizon: env.horizonUrl },
    `PathPulse Backend Core listening on :${env.port}`,
  );
});
