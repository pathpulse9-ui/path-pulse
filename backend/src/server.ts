import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger }));
  app.use(router);
  app.use(errorHandler);
  return app;
}
