import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@pathpulse/contract';
import { logger } from '../config/logger.js';
import { sendAlertInBackground } from '../services/alerts.js';
import { captureException } from '../observability/sentry.js';

const ALERTING_ERRORS = new Set([
  'MainnetGateClosed',
  'PayoutProviderUnavailable',
  'HorizonRejected',
  'IdempotencyUnavailable',
]);

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

  const status = err?.status ?? 500;
  if (ALERTING_ERRORS.has(err?.name) || status >= 500) {
    captureException(err, { requestId, path: req.path });
    sendAlertInBackground({
      key: `error:${err?.name ?? 'InternalError'}:${req.path}`,
      severity: 'critical',
      title: `${err?.name ?? 'InternalError'} on ${req.method} ${req.path}`,
      detail: err?.message,
    });
  }

  const exposed = status < 500;
  const body: ApiError = {
    error: exposed ? (err?.name ?? 'Error') : 'InternalError',
    message: exposed ? (err?.message ?? 'Request failed') : 'Something went wrong on our side. Quote the request id if you contact support.',
    requestId,
  };
  res.status(status).json(body);
};
