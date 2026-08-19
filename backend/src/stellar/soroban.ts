import { rpc, Transaction } from '@stellar/stellar-sdk';
import { env } from '../config/env.js';
import { horizon } from './network.js';
import type { Signer } from './signing.js';

export const sorobanServer = new rpc.Server(env.routing.sorobanRpcUrl, {
  allowHttp: env.routing.sorobanRpcUrl.startsWith('http://'),
});

function httpError(message: string, status: number, name: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.name = name;
  e.status = status;
  return e;
}

export interface SorobanResult {
  hash: string;
  ledger?: number;
}

const POLL_INTERVAL_MS = 1000;
const POLL_ATTEMPTS = 30;

export async function simulateAndSubmit(tx: Transaction, signer: Signer): Promise<SorobanResult> {
  let prepared: Transaction;
  try {
    prepared = (await sorobanServer.prepareTransaction(tx)) as Transaction;
  } catch (e) {
    throw httpError(`Soroban simulation failed: ${String(e)}`, 422, 'SorobanSimulationFailed');
  }

  const signed = await signer.sign(prepared);
  const sent = await sorobanServer.sendTransaction(signed);
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
    if (record.successful) return { hash: sent.hash, ledger: record.ledger_attr };
    throw httpError(`Swap transaction failed on-chain (${sent.hash})`, 422, 'SorobanFailed');
  }
  throw httpError(
    `Swap transaction ${sent.hash} not confirmed after ${POLL_ATTEMPTS}s`,
    504,
    'SorobanTimeout',
  );
}
