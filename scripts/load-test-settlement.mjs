#!/usr/bin/env node
// Load test for the settlement indexer (Phase 6 QA: "load tests on batch
// payouts and indexer"). Default mode is read-only and safe to run against
// a live deploy repeatedly — it hammers GET /v1/settlement/batches and the
// CSV export at concurrency.
//
// A write burst (real testnet settlement transactions + Friendbot-funded
// drivers) is opt-in via --with-writes, since unlike the read path it has a
// real cost (Horizon txs, Friendbot rate limits) and is where a sequencing
// bug would actually show up — sequential POSTs from one source account are
// expected to serialize on Horizon's sequence number, so this also doubles
// as a check that concurrent settlement submits don't corrupt the sequence.
//
// Usage:
//   node scripts/load-test-settlement.mjs [--base http://localhost:8080]
//     [--requests 200] [--concurrency 20] [--with-writes] [--write-count 5]

import { Keypair } from '@stellar/stellar-sdk';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}
const has = (name) => args.includes(`--${name}`);

const base = flag('base', process.env.API_BASE_URL ?? 'http://localhost:8080');
const requests = Number(flag('requests', 200));
const concurrency = Number(flag('concurrency', 20));
const withWrites = has('with-writes');
const writeCount = Number(flag('write-count', 5));

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function timed(fn) {
  const start = performance.now();
  try {
    const res = await fn();
    return { ms: performance.now() - start, ok: res.ok, status: res.status };
  } catch (e) {
    return { ms: performance.now() - start, ok: false, status: 0, error: String(e) };
  }
}

async function runPool(total, size, fn) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < total) {
      const i = next++;
      results.push(await fn(i));
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

function summarize(label, results) {
  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok);
  console.log(`\n${label}`);
  console.log(`  requests: ${results.length}  errors: ${errors.length} (${((errors.length / results.length) * 100).toFixed(1)}%)`);
  console.log(`  p50: ${percentile(durations, 50).toFixed(0)}ms  p95: ${percentile(durations, 95).toFixed(0)}ms  p99: ${percentile(durations, 99).toFixed(0)}ms  max: ${durations[durations.length - 1].toFixed(0)}ms`);
  if (errors.length) {
    const byStatus = errors.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
    console.log(`  error statuses: ${JSON.stringify(byStatus)}`);
  }
  return errors.length;
}

async function main() {
  console.log(`Load-testing ${base}  requests=${requests} concurrency=${concurrency}`);

  const listResults = await runPool(requests, concurrency, () =>
    timed(() => fetch(`${base}/v1/settlement/batches?limit=50`)),
  );
  let failed = summarize('GET /v1/settlement/batches', listResults);

  const csvResults = await runPool(Math.max(1, Math.round(requests / 4)), Math.max(1, Math.round(concurrency / 4)), () =>
    timed(() => fetch(`${base}/v1/settlement/batches/export.csv?limit=200`)),
  );
  failed += summarize('GET /v1/settlement/batches/export.csv', csvResults);

  if (withWrites) {
    console.log(`\nWrite burst: ${writeCount} concurrent settlement batches (real testnet txs)`);
    const driver = Keypair.random();
    await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(driver.publicKey())}`);
    const writeResults = await runPool(writeCount, writeCount, (i) =>
      timed(() =>
        fetch(`${base}/v1/settlement/batches`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grossAmount: '1',
            drivers: [{ userId: `loadtest-${i}`, address: driver.publicKey(), tier: 1 }],
          }),
        }),
      ),
    );
    failed += summarize('POST /v1/settlement/batches (concurrent)', writeResults);
  } else {
    console.log('\n(skipping write burst — pass --with-writes to include it)');
  }

  console.log(`\n${failed === 0 ? 'Load test passed with no errors.' : `${failed} request(s) failed — see above.`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('load test crashed:', e);
  process.exit(1);
});
