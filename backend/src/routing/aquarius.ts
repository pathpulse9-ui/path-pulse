import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { fetchWithTimeout } from '../net/fetchWithTimeout.js';
import { resolveAsset, type RoutableSymbol } from './assets.js';

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

interface FindPathResponse {
  success: boolean;
  swap_chain_xdr: string;
  pools: string[];
  tokens: string[];
  amount: string | number;
}

export interface RoutePath {
  swapChainXdr: string;
  pools: string[];
  tokens: string[];
  destinationStroops: bigint;
}

export async function findPath(
  from: RoutableSymbol,
  to: RoutableSymbol,
  sourceStroops: bigint,
  signal?: AbortSignal,
): Promise<RoutePath> {
  if (from === to) {
    throw httpError('from and to must be different assets', 400, 'ValidationError');
  }
  const body = JSON.stringify({
    token_in_address: resolveAsset(from).contractId,
    token_out_address: resolveAsset(to).contractId,
    amount: sourceStroops.toString(),
  });

  let res: Response;
  try {
    res = await fetchWithTimeout(`${env.routing.aquaApiUrl}/find-path/`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      signal,
    });
  } catch (e) {
    logger.warn({ err: e }, 'aquarius api unreachable');
    throw httpError('Aquarius API unreachable', 502, 'RoutingUnavailable');
  }
  if (!res.ok) {
    logger.warn({ status: res.status, body: await res.text().catch(() => '') }, 'aquarius api error');
    throw httpError(`Aquarius API HTTP ${res.status}`, 502, 'RoutingUnavailable');
  }

  const data = (await res.json()) as FindPathResponse;
  if (!data.success || !data.swap_chain_xdr) {
    throw httpError(`No route found for ${from} → ${to}`, 422, 'NoRoute');
  }

  return {
    swapChainXdr: data.swap_chain_xdr,
    pools: data.pools ?? [],
    tokens: data.tokens ?? [],
    destinationStroops: parseStroopAmount(data.amount),
  };
}

export function parseStroopAmount(raw: unknown): bigint {
  const text = String(raw ?? '');
  if (!/^\d{1,25}$/.test(text)) throw httpError('Aquarius returned an invalid amount', 502, 'RoutingUnavailable');
  return BigInt(text);
}

export function applySlippage(destinationStroops: bigint): bigint {
  const bps = BigInt(env.routing.slippageBps);
  return (destinationStroops * (10_000n - bps)) / 10_000n;
}
