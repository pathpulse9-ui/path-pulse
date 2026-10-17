import type { Request } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

const limitSchema = z.coerce.number().int().min(1).max(500);
const cursorSchema = z.string().min(1).max(512);
const isoDateSchema = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date');
const amountQuerySchema = z.string().regex(/^\d{1,15}(\.\d{1,7})?$/, 'must be a decimal amount');

function invalid(message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = 'ValidationError';
  e.status = 400;
  return e;
}

function first(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function parseQuery<T>(schema: z.ZodType<T>, req: Request, key: string): T | undefined {
  const raw = first(req, key);
  if (raw === undefined) return undefined;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(`${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data;
}

export const limitParam = (req: Request) => parseQuery(limitSchema, req, 'limit');
export const cursorParam = (req: Request) => parseQuery(cursorSchema, req, 'cursor');
export const dateParam = (req: Request, key: string) => parseQuery(isoDateSchema, req, key);
export const amountParam = (req: Request, key: string) => parseQuery(amountQuerySchema, req, key);

export function stellarAddressParam(value: string | undefined, label = 'address'): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!StrKey.isValidEd25519PublicKey(value)) throw invalid(`${label} must be a Stellar public key`);
  return value;
}

export function batchFilters(req: Request) {
  return {
    network: first(req, 'network'),
    assetCode: parseQuery(z.string().regex(/^[A-Za-z0-9]{1,12}$/), req, 'assetCode'),
    since: dateParam(req, 'since'),
    until: dateParam(req, 'until'),
    minAmount: amountParam(req, 'minAmount'),
    maxAmount: amountParam(req, 'maxAmount'),
  };
}

const MAX_EXPORT_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

export function exportRange(req: Request): { since: string; until: string } {
  const since = dateParam(req, 'since');
  if (!since) throw invalid('since is required for exports (ISO date)');
  const until = dateParam(req, 'until') ?? new Date().toISOString();
  const span = Date.parse(until) - Date.parse(since);
  if (span < 0) throw invalid('until must be after since');
  if (span > MAX_EXPORT_SPAN_MS) throw invalid('export range cannot exceed 366 days');
  return { since, until };
}
