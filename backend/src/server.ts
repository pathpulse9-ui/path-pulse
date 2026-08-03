import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createServer() {
  const app = express();
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
  app.use(router);
  app.use(errorHandler);
  return app;
}
