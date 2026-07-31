import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@pathpulse/contract';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as any).id;
  logger.error({ err, requestId }, 'request failed');

  if (err instanceof ZodError) {
    const body: ApiError = {
      error: 'ValidationError',
      message: err.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; '),
      requestId,
    };
    res.status(400).json(body);
    return;
  }

  const body: ApiError = {
    error: err?.name ?? 'InternalError',
    message: err?.message ?? 'Unexpected error',
    requestId,
  };
  res.status(err?.status ?? 500).json(body);
};
