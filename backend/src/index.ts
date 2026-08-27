import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { migrate } from './db/client.js';

const app = createServer();

await migrate();

app.listen(env.port, '0.0.0.0', () => {
  logger.info(
    { port: env.port, network: env.network, horizon: env.horizonUrl },
    `PathPulse Backend Core listening on :${env.port}`,
  );
});
