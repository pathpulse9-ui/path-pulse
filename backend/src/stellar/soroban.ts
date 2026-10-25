import { rpc, scValToNative, Transaction, type xdr } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { horizon } from './network.js';
import { assertMainnetAllowed } from './networkGuard.js';
import type { Signer } from './signing.js';
import { logUpstream } from '../util/upstreamLog.js';

let server: rpc.Server | null = null;

export function sorobanServer(): rpc.Server {
  if (!env.routing.sorobanRpcUrl) {
    throw httpError('SOROBAN_RPC_URL is not configured', 500, 'ConfigError');
  }
  server ??= new rpc.Server(env.routing.sorobanRpcUrl, {
    allowHttp: env.routing.sorobanRpcUrl.startsWith('http://'),
  });
  return server;
}

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export interface SorobanResult {
  hash: string;
  ledger?: number;
  returnStroops?: bigint;
}

const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 30;

export function stroopsFromScVal(value: xdr.ScVal): bigint | undefined {
  const native = scValToNative(value);
  return typeof native === 'bigint' && native >= 0n ? native : undefined;
}

async function returnedAmount(hash: string): Promise<bigint | undefined> {
  try {
    const tx = await sorobanServer().getTransaction(hash);
    if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS || !tx.returnValue) return undefined;
    return stroopsFromScVal(tx.returnValue);
  } catch {
    return undefined;
  }
}

export async function simulateAndSubmit(tx: Transaction, signer: Signer): Promise<SorobanResult> {
  assertMainnetAllowed('soroban submit');
  let prepared: Transaction;
  try {
    prepared = (await sorobanServer().prepareTransaction(tx)) as Transaction;
  } catch (e) {
    logUpstream('soroban simulation failed', e);
    throw httpError('Soroban simulation failed', 422, 'SorobanSimulationFailed');
  }

  const signed = await signer.sign(prepared);
  const sent = await sorobanServer().sendTransaction(signed);
  if (sent.status === 'ERROR' || sent.status === 'DUPLICATE') {
    throw httpError(
      `Soroban submit rejected (${sent.status}): ${JSON.stringify(sent.errorResult ?? {})}`,
      422,
      'SorobanRejected',
    );
  }

  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let record;
    try {
      record = await horizon.transactions().transaction(sent.hash).call();
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) continue;
      throw e;
    }
    if (record.successful) {
      return { hash: sent.hash, ledger: record.ledger_attr, returnStroops: await returnedAmount(sent.hash) };
    }
    throw httpError(`Swap transaction failed on-chain (${sent.hash})`, 422, 'SorobanFailed');
  }
  throw httpError(
    `Swap transaction ${sent.hash} not confirmed after ${POLL_ATTEMPTS}s`,
    504,
    'SorobanTimeout',
  );
}
