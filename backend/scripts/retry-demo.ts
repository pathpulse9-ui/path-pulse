import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { migrate, closeDb } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { createPayoutBatch } from '../src/services/payouts.js';
import { listAttempts } from '../src/services/payoutAttempts.js';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const CONTAINER = 'sdp-sdp-api-1';
const horizon = new Horizon.Server(env.horizonUrl);
const log: string[] = [];

function say(line = ''): void {
  console.log(line);
  log.push(line);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function provision(label: string): Promise<Keypair> {
  const kp = Keypair.random();
  await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
  say(`    ${label}  ${kp.publicKey()}`);
  return kp;
}

async function main() {
  await migrate();
  say('CONTROLLED FAILURE AND RETRY - live SDP');
  say('='.repeat(70));
  say(`SDP endpoint        : ${env.sdp.baseUrl}`);
  say(`retry attempts      : ${env.sdp.retryAttempts}`);
  say(`backoff base        : ${env.sdp.retryBaseDelayMs}ms`);
  say('');

  say('[1] Provisioning recipients (funded + USDC trustline)');
  const a = await provision('driver-1');
  const b = await provision('driver-2');
  say('');

  say('[2] Taking SDP offline  ->  docker stop ' + CONTAINER);
  sh(`docker stop ${CONTAINER}`);
  say(`    status: ${sh(`docker inspect -f '{{.State.Status}}' ${CONTAINER}`)}`);
  say('');

  const restoreAfterMs = Math.max(3000, env.sdp.retryBaseDelayMs - 4000);
  say(`[3] Starting payout batch - attempt 1 will fail, SDP restored in ${restoreAfterMs}ms`);
  const restore = (async () => {
    await wait(restoreAfterMs);
    sh(`docker start ${CONTAINER}`);
    say(`    SDP restored     : ${sh(`docker inspect -f '{{.State.Status}}' ${CONTAINER}`)}`);
  })();

  const run = Date.now().toString(36);
  const recipients = [
    { userId: `retry-${run}-a`, address: a.publicKey(), tier: 1 as const, amount: '0.0100000' },
    { userId: `retry-${run}-b`, address: b.publicKey(), tier: 2 as const, amount: '0.0100000' },
  ];

  let batchId = '';
  let failure = '';
  try {
    const batch = await createPayoutBatch(recipients as never, { code: 'USDC', issuer: USDC_ISSUER });
    batchId = batch.id;
    say('');
    say('[4] Batch succeeded after retry');
    say(`    batch id        : ${batch.id}`);
    say(`    disbursement id : ${batch.disbursementId}`);
    say(`    asset           : USDC ${USDC_ISSUER}`);
    say(`    total           : ${batch.totalAmount} USDC`);
  } catch (e) {
    failure = (e as Error).message;
    say('');
    say(`[4] Batch failed: ${failure}`);
  }
  await restore;

  say('');
  say('[5] Attempt records (reconciliation)');
  if (batchId) {
    for (const at of await listAttempts(batchId)) {
      const err = at.error ? `  ${at.error.slice(0, 90)}` : '';
      say(`    #${at.attempt} ${at.step.padEnd(20)} ${at.outcome.padEnd(8)} ${String(at.duration_ms).padStart(6)}ms${err}`);
    }
  }
  say('');
  say(`recipients: ${recipients.map((r) => `${r.address} ${r.amount}`).join(' | ')}`);

  const out = `retry-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(out, log.join('\n') + '\n');
  say('');
  say(`saved: backend/${out}`);
  await closeDb();
}

main().catch(async (e) => {
  try { sh(`docker start ${CONTAINER}`); } catch { /* already running */ }
  console.error('FAILED:', e.message);
  process.exit(1);
});
