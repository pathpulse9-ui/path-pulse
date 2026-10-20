import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.PATHPULSE_API_URL ?? 'https://demo-api.pathpulse.ai';
const HORIZON = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
const KEY = process.env.PARTNER_API_KEY ?? '';
const BATCH_ID = process.argv[2] ?? '';

type Check = { name: string; ok: boolean; detail: string };

async function api<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function horizonTx(hash: string): Promise<{ successful: boolean; ledger: number; created_at: string } | null> {
  const res = await fetch(`${HORIZON}/transactions/${hash}`);
  return res.ok ? ((await res.json()) as { successful: boolean; ledger: number; created_at: string }) : null;
}

async function main() {
  if (!/^pp_/.test(KEY)) throw new Error('set PARTNER_API_KEY to a partner key (pp_<id>_<secret>)');
  if (!BATCH_ID) throw new Error('usage: PARTNER_API_KEY=pp_… tsx scripts/partner-trace.ts <settlement batch id>');
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  };

  const list = await api<{ items: { id: string }[] }>('/v1/settlement/batches?limit=20');
  check('partner key lists settlement batches', list.items.length > 0, `${list.items.length} batch(es) returned`);

  type Batch = {
    id: string; txHash: string; grossAmount: string; split: { authorities: string; driverRewards: string; treasury: string };
    payoutBatchId?: string; deposit?: { txHash?: string; from?: string; amount?: string };
    driverPayouts?: { userId: string; address: string; amount: string; payoutTxHash?: string }[];
  };
  const batch = await api<Batch>(`/v1/settlement/batches/${BATCH_ID}`);
  check('partner key reads the batch drill-down', batch.id === BATCH_ID, `${batch.grossAmount} gross, ${batch.driverPayouts?.length ?? 0} driver payout(s)`);

  const stroops = (s: string) => BigInt(Math.round(Number(s) * 1e7));
  const g = stroops(batch.grossAmount);
  check(
    'split is exactly 50/30/20 of the gross',
    stroops(batch.split.authorities) === g / 2n && stroops(batch.split.treasury) === g / 5n &&
      stroops(batch.split.authorities) + stroops(batch.split.driverRewards) + stroops(batch.split.treasury) === g,
    `${batch.split.authorities} / ${batch.split.driverRewards} / ${batch.split.treasury}`,
  );

  if (batch.deposit?.txHash) {
    const dep = await horizonTx(batch.deposit.txHash);
    check('funding deposit is on the ledger', !!dep?.successful, `${batch.deposit.txHash.slice(0, 8)}… ledger ${dep?.ledger ?? '-'}`);
  } else {
    check('funding deposit is linked', false, 'batch has no deposit hash');
  }

  const split = await horizonTx(batch.txHash);
  check('split transaction is on the ledger', !!split?.successful, `${batch.txHash.slice(0, 8)}… ledger ${split?.ledger ?? '-'}`);

  if (batch.payoutBatchId) {
    const payout = await api<{ status: string; receipts?: unknown[] }>(`/v1/ops/payouts/batches/${batch.payoutBatchId}`);
    check('partner key reads the SDP payout batch', true, `${batch.payoutBatchId} status ${payout.status}`);
  }

  for (const p of batch.driverPayouts ?? []) {
    if (!p.payoutTxHash) {
      check(`driver ${p.userId} payout hash`, false, 'not recorded yet');
      continue;
    }
    const tx = await horizonTx(p.payoutTxHash);
    check(`driver ${p.userId} paid on the ledger`, !!tx?.successful, `${p.amount} → ${p.address.slice(0, 8)}… tx ${p.payoutTxHash.slice(0, 8)}…`);
  }

  const ledger = await api<{ items: unknown[] }>('/v1/gov/ledger?limit=20');
  check('partner key reads the chain index', Array.isArray(ledger.items), `${ledger.items.length} indexed payment(s)`);

  const csv = await fetch(`${API}/v1/settlement/batches/payouts.csv?since=2026-10-01`, { headers: { authorization: `Bearer ${KEY}` } });
  check('partner key exports the payouts CSV', csv.ok, `HTTP ${csv.status}, ${(await csv.text()).split('\n').length - 1} row(s)`);

  const out = join(import.meta.dirname, '../../docs/evidence', `d8-partner-trace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  await mkdir(join(out, '..'), { recursive: true });
  await writeFile(out, JSON.stringify({ api: API, batchId: BATCH_ID, ranAt: new Date().toISOString(), checks, batch }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed · evidence: ${out}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
