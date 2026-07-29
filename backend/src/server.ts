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
  app.use(express.json());
  app.use(pinoHttp({ logger }));
  app.use(router);
  app.use(errorHandler);
  return app;
}
