import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SettlementBatch } from '@pathpulse/contract';
import { payoutsToCsv } from './settlementExport.js';

const batch = {
  id: 'b1',
  createdAt: '2026-10-12T00:00:00.000Z',
  network: 'mainnet',
  asset: { code: 'USDC' },
  txHash: 'settlehash',
  payoutBatchId: 'pb1',
  deposit: { txHash: 'deposithash', from: 'GFROM', amount: '10', receivedAt: '2026-10-11T00:00:00.000Z' },
  driverPayouts: [
    { userId: 'u1', address: 'GA1', tier: 2, multiplier: 1.2, amount: '1.5000000' },
    { userId: 'u,2', address: 'GA2', tier: 1, multiplier: 1, amount: '1.0000000' },
  ],
} as unknown as SettlementBatch;

test('payoutsToCsv emits one row per driver traced to the treasury deposit', () => {
  const lines = payoutsToCsv([batch]).trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^batch_id,.*treasury_deposit_tx_hash,settlement_tx_hash,payout_batch_id,user_id/);
  assert.equal(lines[1], 'b1,2026-10-12T00:00:00.000Z,mainnet,USDC,deposithash,settlehash,pb1,u1,GA1,2,1.2,1.5000000');
  assert.match(lines[2], /,"u,2",GA2,1,1,1\.0000000$/);
});

test('payoutsToCsv with no payouts is the header only', () => {
  assert.equal(payoutsToCsv([{ ...batch, driverPayouts: [] }]).trimEnd().split('\n').length, 1);
});
