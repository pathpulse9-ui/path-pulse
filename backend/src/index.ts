import { createServer } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createServer();

app.listen(env.port, () => {
  logger.info(
    { port: env.port, network: env.network, horizon: env.horizonUrl },
    `PathPulse Backend Core listening on :${env.port}`,
  );
});
