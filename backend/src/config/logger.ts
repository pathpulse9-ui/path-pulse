import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["x-carret-signature"]',
    'req.headers["x-body-signature"]',
    'res.headers["set-cookie"]',
    '*.passcode',
    '*.idToken',
    '*.secret',
    '*.seed',
    '*.apiKey',
    '*.api_key',
  ],
  transport:
    env.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
