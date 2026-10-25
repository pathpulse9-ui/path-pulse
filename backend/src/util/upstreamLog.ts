import { logger } from '../config/logger.js';

export function logUpstream(context: string, err: unknown): void {
  logger.warn({ err }, context);
}
