import { env } from '../src/config/env.js';
import { closeDb, migrate } from '../src/db/client.js';
import { countLegacySeeds, resealLegacySeeds } from '../src/stellar/managed.js';

async function main() {
  await migrate();
  const before = await countLegacySeeds();
  console.log(`network ${env.network}: ${before} managed wallet(s) hold unbound v1 seals`);
  if (!before) return;
  if (!process.argv.includes('--confirm')) {
    console.log('re-run with --confirm to rebind them (images older than this change cannot read rebound seals)');
    return;
  }
  const resealed = await resealLegacySeeds();
  console.log(`rebound ${resealed}; ${await countLegacySeeds()} left (left rows did not match their public key)`);
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));
