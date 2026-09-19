/**
 * D6 evidence: one unbroken chain from a validation score to money.
 *
 *   existing driver → score read from the feed → SCOUT assignment tx
 *   → settlement whose payout applies that tier's multiplier
 *
 * No score is entered anywhere. `POST /v1/scout/assign` takes a driver id and
 * nothing else; the score comes from `scoreProvider()`. With PULSEGEN_BASE_URL
 * and PULSEGEN_API_KEY set that is the live PulseGen feed (`source: pulsegen`);
 * without them it is the deterministic synthetic feed (`source: synthetic`),
 * which derives a stable score from the driver id so the same driver always
 * scores the same and no operator can hand-pick a tier.
 *
 *   pnpm --filter @pathpulse/backend exec tsx scripts/demo-pulsegen-to-settlement.ts \
 *     [--drivers a,b,c] [--gross 1] [--reassign]
 */
import { SCOUT_MULTIPLIER } from '@pathpulse/contract';
import { migrate, closeDb } from '../src/db/client.js';
import { resolveAsset } from '../src/routing/assets.js';
import { provisionManagedWallet, getManagedWallet } from '../src/stellar/managed.js';
import { assignTierForDriver, getOnchainTier, revokeTier, scoreToTier } from '../src/stellar/scout.js';
import { executeSettlementBatch, getSettlementBatch } from '../src/stellar/settlement.js';
import { resolveScore, pulseGenLive } from '../src/services/pulsegen.js';
import { listImports } from '../src/services/scoreStore.js';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (v === undefined && fallback === undefined) throw new Error(`--${name} is required`);
  return v ?? (fallback as string);
}

async function main(): Promise<void> {
  const driverIds = arg('drivers', 'drv-pulsegen-demo-002,drv-pulsegen-demo-003,drv-pulsegen-demo-006')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  const gross = arg('gross', '1');
  const reassign = process.argv.includes('--reassign');
  await migrate();

  console.log('\n── 0. score feed in use ──');
  const [latestImport] = await listImports(1);
  console.log({
    pulseGenLive: pulseGenLive(),
    mode: pulseGenLive() ? 'pulsegen-live' : latestImport ? 'pulsegen-batch' : 'synthetic',
  });
  if (latestImport) {
    console.log('latest delivery:', {
      importId: latestImport.id,
      supplier: latestImport.supplier,
      sourceRef: latestImport.sourceRef,
      receivedAt: latestImport.receivedAt,
      payloadSha256: latestImport.payloadSha256,
      scoreCount: latestImport.scoreCount,
    });
    console.log('provenance attests to receipt from the supplier, not to correctness.');
  }
  if (!pulseGenLive() && !latestImport) {
    console.log('No live feed and no delivered batch — deterministic synthetic interim.');
  }
  console.log('No score is entered anywhere: the API has no score parameter.');

  const rows: {
    driverId: string;
    address: string;
    score: number;
    scoredAt: string;
    source: string;
    tier: number;
    multiplier: number;
    assignmentTx: string;
  }[] = [];

  for (const driverId of driverIds) {
    let wallet = await getManagedWallet(driverId);
    if (!wallet) {
      console.log(`\ndriver ${driverId} not found — provisioning, then treating as existing`);
      wallet = await provisionManagedWallet(driverId);
    }

    const validation = await resolveScore(driverId);
    const expected = scoreToTier(validation.score);
    console.log(`\n── ${driverId} ──`);
    console.log({
      address: wallet.address,
      ...validation,
      mapsToTier: expected,
    });

    const before = await getOnchainTier(wallet.address);
    if (before.tier === expected && reassign) {
      const rev = await revokeTier(wallet.address);
      console.log(`revoked existing ${rev.assetCode} for a fresh assignment (tx ${rev.txHash})`);
    }

    const current = await getOnchainTier(wallet.address);
    let assignmentTx = '(already held — re-run with --reassign for a fresh tx)';
    if (current.tier !== expected) {
      const assignment = await assignTierForDriver(driverId);
      assignmentTx = assignment.txHash;
      console.log(`assigned ${assignment.assetCode} @ ${assignment.multiplier}x  tx ${assignment.txHash}`);
    } else {
      console.log(`already holds SCOUT${current.tier} @ ${current.multiplier}x`);
    }

    const onchain = await getOnchainTier(wallet.address);
    if (onchain.tier !== expected) {
      throw new Error(`${driverId}: on-chain badge ${onchain.tier} != score-derived tier ${expected}`);
    }

    rows.push({
      driverId,
      address: wallet.address,
      score: validation.score,
      scoredAt: validation.scoredAt,
      source: validation.source,
      tier: expected,
      multiplier: SCOUT_MULTIPLIER[expected as 1 | 2 | 3],
      assignmentTx,
    });
  }

  console.log('\n── settlement applying those tier multipliers ──');
  console.log('every driver is submitted as tier 1 — the engine must read the badge instead');

  const batch = await executeSettlementBatch({
    grossAmount: gross,
    asset: resolveAsset('USDC').ref,
    drivers: rows.map((r) => ({ userId: r.driverId, address: r.address, tier: 1 as const })),
  }).catch(async (e: Error) => {
    const settled = /settled on-chain \(tx [0-9a-f]+\)/.test(e.message);
    const id = e.message.match(/(stl_[0-9a-z_]+)/)?.[1];
    if (!settled || !id) throw e;
    console.log(
      `\nSDP fan-out unavailable. The on-chain split is already final and persisted — ` +
        `reading batch ${id} back from the indexer. Driver fan-out is D2/D3, proven separately.`,
    );
    return getSettlementBatch(id);
  });

  console.log({
    batchId: batch.id,
    txHash: batch.txHash,
    gross: batch.grossAmount,
    asset: batch.asset.code,
    split: batch.split,
    horizonUrl: batch.horizonUrl,
  });

  console.log('\n── the chain, end to end ──');
  for (const r of rows) {
    const payout = batch.driverPayouts.find((p) => p.address === r.address);
    if (payout?.tier !== r.tier) {
      throw new Error(`${r.driverId}: settlement used tier ${payout?.tier}, not badge tier ${r.tier}`);
    }
    console.log(
      `${r.driverId}  score ${r.score.toFixed(6)} (${r.source})  → SCOUT${r.tier} @ ${r.multiplier}x  → paid ${payout.amount} USDC`,
    );
    console.log(`    assignment tx ${r.assignmentTx}`);
  }

  const base = rows[0];
  const basePay = Number(batch.driverPayouts.find((p) => p.address === base.address)?.amount);
  console.log('\nratio against the lowest-tier driver:');
  for (const r of rows) {
    const amt = Number(batch.driverPayouts.find((p) => p.address === r.address)?.amount);
    console.log(`  ${r.driverId}  ${(amt / basePay).toFixed(4)}x  (expected ${(r.multiplier / base.multiplier).toFixed(4)}x)`);
  }

  const sum = batch.driverPayouts.reduce((t, p) => t + Number(p.amount), 0);
  console.log(`\ndriver payouts sum to ${sum.toFixed(7)} = ${batch.split.driverRewards} (the 30% pool)`);
  console.log(`\nOK — no score entered; every tier read from chain; batch ${batch.id}`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
