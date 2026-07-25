import type { ErrorRequestHandler } from 'express';
import type { ApiError } from '@pathpulse/contract';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id;
  logger.error({ err, requestId }, 'request failed');
  const body: ApiError = {
    error: err?.name ?? 'InternalError',
    message: err?.message ?? 'Unexpected error',
    requestId,
  };
  res.status(err?.status ?? 500).json(body);
};
