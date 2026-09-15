#!/usr/bin/env node
// Read-only smoke check for the "Manual smoke" step of docs/MAINNET_CUTOVER.md.
// Never submits a real transaction: the settlement check sends a syntactically
// valid body specifically to confirm it is refused by the mainnet gate, not to
// get it to execute.
//
// Usage:
//   node scripts/mainnet-smoke-check.mjs [--base https://demo-api.pathpulse.ai] [--network mainnet]

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const base = flag('base', process.env.API_BASE_URL ?? 'http://localhost:8080');
const expectNetwork = flag('network', 'mainnet');

let failures = 0;
function check(label, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log(`Smoke-checking ${base} (expecting network=${expectNetwork})\n`);

  const health = await getJson('/health');
  check('GET /health returns 200', health.status === 200, `status=${health.status}`);
  check(
    `GET /health reports network=${expectNetwork}`,
    health.body.network === expectNetwork,
    `got network=${health.body.network}`,
  );

  const treasury = await getJson('/v1/treasury/config');
  check('GET /v1/treasury/config returns 200', treasury.status === 200);
  check(
    `GET /v1/treasury/config network matches (${expectNetwork})`,
    treasury.body.network === expectNetwork,
    `got network=${treasury.body.network}`,
  );
  check(
    'treasury has at least one signer',
    Array.isArray(treasury.body.signers) && treasury.body.signers.length > 0,
  );

  const accounts = await getJson('/v1/accounts/distribution');
  check('GET /v1/accounts/distribution returns 200', accounts.status === 200);
  const roles = Array.isArray(accounts.body) ? accounts.body.map((a) => a.role) : [];
  for (const role of ['partner_revenue', 'driver_pool', 'treasury']) {
    check(`distribution accounts include ${role}`, roles.includes(role));
  }
  if (Array.isArray(accounts.body)) {
    check(
      `distribution accounts are on ${expectNetwork}`,
      accounts.body.every((a) => a.network === expectNetwork),
      `networks=${[...new Set(accounts.body.map((a) => a.network))].join(',')}`,
    );
  }

  // Syntactically valid body so the request clears zod validation and actually
  // reaches assertMainnetAllowed() — a malformed body would 400 first and prove
  // nothing about the gate.
  const settlementRes = await fetch(`${base}/v1/settlement/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grossAmount: '0.0000001',
      drivers: [{ userId: 'smoke-check', address: 'G'.padEnd(56, 'A'), tier: 1 }],
    }),
  });
  const settlementBody = await settlementRes.json().catch(() => ({}));
  if (expectNetwork === 'mainnet') {
    check(
      'POST /v1/settlement/batches refuses with MainnetGateClosed',
      settlementRes.status === 403 && settlementBody.error === 'MainnetGateClosed',
      `status=${settlementRes.status} error=${settlementBody.error}`,
    );
  } else {
    console.log(`[SKIP] mainnet-gate check (network=${expectNetwork}, not mainnet)`);
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke check crashed:', e);
  process.exit(1);
});
