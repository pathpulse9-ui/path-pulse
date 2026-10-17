import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { registerSentryErrorHandler, sentryUserFromSession } from './observability/sentry.js';
import { authLimiter, partnerKeyLimiter, writeLimiter } from './middleware/rateLimit.js';

export function createServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.webAppUrl, credentials: true }));
  app.use(cookieParser());
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(pinoHttp({ logger }));
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
  app.use(sentryUserFromSession());
  app.use(partnerKeyLimiter);
  app.use(router);
  registerSentryErrorHandler(app);
  app.use(errorHandler);
  return app;
}
