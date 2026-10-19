import * as Sentry from '@sentry/node';
import type { Express, NextFunction, Request, Response } from 'express';
import { env, numEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Backend error monitoring.
 *
 * Fully opt-in: unless `SENTRY_DSN` is in the environment the SDK is never
 * initialized and every call here is a cheap no-op. That keeps local dev,
 * tests, and smoke-test runs free of noise.
 *
 * Enabled release wiring (SENTRY_RELEASE), environment (SENTRY_ENVIRONMENT),
 * and sample rate (SENTRY_TRACES_SAMPLE_RATE) are all env-driven so the
 * same binary can ship to staging and prod with different noise budgets.
 */

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry disabled: SENTRY_DSN not set');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? env.network,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: numEnv('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
    beforeSend(event, hint) {
      const err = hint?.originalException as { status?: number } | undefined;
      if (err?.status && err.status < 500 && err.status !== 429) return null;
      return scrubEvent(event);
    },
    beforeSendTransaction: (event) => scrubEvent(event),
  });
  initialized = true;
  logger.info({ environment: process.env.SENTRY_ENVIRONMENT ?? env.network }, 'Sentry initialized');
}

type ScrubbableEvent = {
  request?: { data?: unknown; cookies?: unknown; query_string?: unknown; headers?: Record<string, unknown> };
  user?: { ip_address?: unknown } & Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    const headers = event.request.headers;
    if (headers) {
      for (const k of Object.keys(headers)) {
        if (/cookie|api-key|authorization|x-forwarded-for|signature/i.test(k)) delete headers[k];
      }
    }
  }
  if (event.user) delete event.user.ip_address;
  return event;
}

/**
 * Register the Sentry error handler on the Express app. Must be installed
 * after all routes but before any other error-handling middleware.
 */
export function registerSentryErrorHandler(app: Express): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

/** Capture an exception from code paths that don't go through Express. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, { extra: context });
}

/** Capture a message (warning / info event). */
export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureMessage(message, { extra: context });
}

/** Express middleware helper to tag the current session's userId onto events. */
export function sentryUserFromSession() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!initialized) { next(); return; }
    const session = (req as unknown as { session?: { userId?: string } }).session;
    if (session?.userId) {
      Sentry.setUser({ id: session.userId });
    }
    next();
  };
}
