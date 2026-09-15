import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authLimiter, writeLimiter } from './middleware/rateLimit.js';

export function createServer() {
  const app = express();
  // App Runner terminates TLS and forwards one proxy hop — without this the
  // rate limiters key every request to the same proxy IP.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.webAppUrl, credentials: true }));
  app.use(cookieParser());
  // Capture the raw body so webhook signatures (Mercuryo X-Signature) verify against
  // the exact bytes the sender signed, not a re-serialization.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(pinoHttp({ logger }));
  // Only the credential-testing surfaces get the tight bucket. `/v1/auth/me` is
  // polled by the web app on every page load and must not share that budget.
  app.use(
    [
      '/v1/auth/partner/login',
      '/v1/auth/ops/login',
      '/v1/auth/google/verify',
      '/v1/auth/wallet/verify',
      '/v1/auth/guest',
    ],
    authLimiter,
  );
  app.use(writeLimiter);
  app.use(router);
  app.use(errorHandler);
  return app;
}
