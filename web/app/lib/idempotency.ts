import { useCallback, useRef } from 'react';
import { ApiError } from './api';

const RETRYABLE_STATUSES = new Set([409, 503]);

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return RETRYABLE_STATUSES.has(error.status);
  return true;
}

export function useIdempotencyKey() {
  const pending = useRef<{ body: string; key: string } | null>(null);

  return useCallback(async function run<T>(body: unknown, call: (key: string) => Promise<T>): Promise<T> {
    const serialized = JSON.stringify(body);
    if (pending.current?.body !== serialized) {
      pending.current = { body: serialized, key: crypto.randomUUID() };
    }
    try {
      const result = await call(pending.current.key);
      pending.current = null;
      return result;
    } catch (e) {
      if (!isRetryable(e)) pending.current = null;
      throw e;
    }
  }, []);
}
