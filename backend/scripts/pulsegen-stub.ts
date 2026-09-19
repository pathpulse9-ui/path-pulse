/**
 * PulseGen stub — a local stand-in for PathPulse.ai's validation engine.
 *
 * PulseGen is the client's system and has no endpoint yet, so the live
 * score-feed client in `services/pulsegen.ts` had no way to be exercised. This
 * serves the contract in `docs/SCORE_FEED_CONTRACT.md` over HTTP so that path
 * can be integration-tested and demonstrated end to end.
 *
 * **It scores nothing.** It reads fixed numbers from a JSON file. Running
 * against it proves our client is correct — the request shape, bearer auth,
 * error handling, timeout and fallback — and proves nothing whatsoever about
 * PulseGen, which does not exist yet. Anything shown to a reviewer while this
 * is running must say so; `GET /v1/scout/feed` reports the endpoint host for
 * exactly that reason, so a `127.0.0.1` value is visible rather than implied.
 *
 *   pnpm --filter @pathpulse/backend exec tsx scripts/pulsegen-stub.ts
 *   PULSEGEN_STUB_PORT=4610 ... scripts/pulsegen-stub.ts --scores my-scores.json
 *
 * Then point the backend at it:
 *   PULSEGEN_BASE_URL=http://127.0.0.1:4610
 *   PULSEGEN_API_KEY=<the key it prints on boot, or PULSEGEN_STUB_KEY>
 */
import { createServer } from 'node:http';
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../.env');
loadEnv(existsSync(rootEnv) ? { path: rootEnv } : {});

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const PORT = Number(process.env.PULSEGEN_STUB_PORT ?? 4610);
const KEY = process.env.PULSEGEN_STUB_KEY ?? randomBytes(24).toString('hex');
const SCORES_FILE = resolve(here, arg('scores') ?? 'fixtures/pulsegen-mock-scores.json');

interface MockScore {
  score: number;
  scored_at: string;
}

function loadScores(): Record<string, MockScore> {
  const parsed = JSON.parse(readFileSync(SCORES_FILE, 'utf8')) as {
    scores?: Record<string, MockScore>;
  };
  return parsed.scores ?? {};
}

function authorized(header: string | undefined): boolean {
  const presented = (header ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(presented);
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/health') return json(200, { ok: true, stub: true });

  const match = url.pathname.match(/^\/v1\/drivers\/([^/]+)\/validation-score$/);
  if (!match) return json(404, { error: 'NotFound', message: `no route for ${url.pathname}` });

  if (!authorized(req.headers.authorization)) {
    return json(401, { error: 'Unauthorized', message: 'bearer token missing or incorrect' });
  }

  const driverId = decodeURIComponent(match[1]);
  const scores = loadScores();
  const found = scores[driverId];
  if (!found) {
    return json(404, { error: 'NotFound', message: `no validation score for ${driverId}` });
  }

  console.log(`[pulsegen-stub] ${driverId} → ${found.score}`);
  return json(200, { score: found.score, scored_at: found.scored_at });
});

server.listen(PORT, '127.0.0.1', () => {
  const ids = Object.keys(loadScores());
  console.log(`[pulsegen-stub] listening on http://127.0.0.1:${PORT}`);
  console.log(`[pulsegen-stub] scores file: ${SCORES_FILE}`);
  console.log(`[pulsegen-stub] drivers: ${ids.join(', ')}`);
  console.log('[pulsegen-stub] MOCK DATA — scores nothing, proves only that our client works');
  if (!process.env.PULSEGEN_STUB_KEY) {
    console.log('[pulsegen-stub] generated a key for this run; set PULSEGEN_STUB_KEY to pin one');
  }
});
