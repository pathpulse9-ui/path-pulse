#!/usr/bin/env node
// End-to-end regression for the Phase 6 exit criterion: onboarding → reward
// payout → settlement split → withdrawal, backend + web scope. Runs against
// a live backend on Stellar testnet — submits a real (tiny) settlement
// transaction, so don't point this at a mainnet-configured deploy.
//
// Side effect: if OFFRAMP_PROVIDER=carret and Carret credentials are live,
// step 7 places a real order against Carret's *dev* tenant (dev.carret.in) —
// same as the orders documented in docs/TESTNET_EVIDENCE.md § D4. No fiat or
// on-chain settlement completes without a separate hand-approved deposit, so
// this is safe to run repeatedly, but it is not a no-op against Carret.
//
// Usage: node scripts/e2e-flow.mjs [--base http://localhost:8080]

import { Keypair } from '@stellar/stellar-sdk';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const base = flag('base', process.env.API_BASE_URL ?? 'http://localhost:8080');

let cookie = '';
let failures = 0;

function step(label) {
  console.log(`\n→ ${label}`);
}
function check(label, ok, detail) {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...init.headers },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function fundWithFriendbot(address) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot failed: ${res.status}`);
}

async function main() {
  console.log(`E2E flow against ${base} (Stellar testnet)`);

  step('1. Onboarding — guest session');
  const guest = await api('/v1/auth/guest', { method: 'POST' });
  check('guest session created', guest.status === 200 && !!guest.body.userId, `status=${guest.status}`);
  const me = await api('/v1/auth/me');
  check('session persists across requests', me.body.user?.method === 'guest');

  step('2. Fund a driver account on testnet (Friendbot)');
  const driver = Keypair.random();
  await fundWithFriendbot(driver.publicKey());
  console.log(`  driver = ${driver.publicKey()}`);

  step('3. Reward payout + settlement split — 50/30/20 batch');
  const settlement = await api('/v1/settlement/batches', {
    method: 'POST',
    body: JSON.stringify({
      grossAmount: '3',
      drivers: [{ userId: 'e2e-driver', address: driver.publicKey(), tier: 1 }],
    }),
  });
  check('settlement batch executed', settlement.status === 200, `status=${settlement.status} body=${JSON.stringify(settlement.body).slice(0, 200)}`);
  const batchId = settlement.body.id;
  check('batch has a Horizon tx hash', typeof settlement.body.txHash === 'string' && settlement.body.txHash.length === 64);
  check(
    'split sums to gross',
    batchId &&
      Number(settlement.body.split?.authorities) +
        Number(settlement.body.split?.driverRewards) +
        Number(settlement.body.split?.treasury) ===
        Number(settlement.body.grossAmount),
  );

  step('4. Settlement is retrievable by id');
  const fetched = batchId ? await api(`/v1/settlement/batches/${batchId}`) : { status: 0 };
  check('GET batch by id', fetched.status === 200 && fetched.body.id === batchId);

  step('5. Settlement appears in the indexer list');
  const list = await api('/v1/settlement/batches?limit=50');
  check(
    'batch present in list',
    Array.isArray(list.body.items) && list.body.items.some((b) => b.id === batchId),
  );

  step('6. Compliance export includes the batch');
  const csvRes = await fetch(`${base}/v1/settlement/batches/export.csv?limit=50`);
  const csv = await csvRes.text();
  check('CSV export contains the batch id', csvRes.status === 200 && batchId && csv.includes(batchId));

  const pdfRes = batchId ? await fetch(`${base}/v1/settlement/batches/${batchId}/receipt.pdf`) : { status: 0 };
  const pdfBytes = pdfRes.status === 200 ? new Uint8Array(await pdfRes.arrayBuffer()) : new Uint8Array();
  check('PDF receipt renders', pdfRes.status === 200 && pdfBytes.length > 500);

  step('7. Withdrawal — off-ramp session linked to the settlement batch');
  const withdrawal = await api('/v1/offramp/sessions', {
    method: 'POST',
    // Carret's live off-ramp enforces a 10 USDC minimum order — keep this at/above
    // that floor regardless of the settlement amounts above.
    body: JSON.stringify({ amount: '10', settlementBatchId: batchId }),
  });
  check('off-ramp session created', withdrawal.status === 200, `status=${withdrawal.status}`);
  check('off-ramp session links back to the settlement batch', withdrawal.body.settlementBatchId === batchId);
  const withdrawalId = withdrawal.body.id;

  const withdrawalStatus = withdrawalId ? await api(`/v1/offramp/sessions/${withdrawalId}`) : { status: 0 };
  check(
    'off-ramp session is pollable',
    withdrawalStatus.status === 200 && typeof withdrawalStatus.body.status === 'string',
    `status=${withdrawalStatus.body?.status}`,
  );

  console.log(`\n${failures === 0 ? 'E2E flow passed end to end.' : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('e2e flow crashed:', e);
  process.exit(1);
});
