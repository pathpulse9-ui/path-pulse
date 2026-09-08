import { env } from '../config/env.js';

/**
 * Mainnet safety gate — call from any code path that constructs or submits a
 * Stellar transaction. When `STELLAR_NETWORK=mainnet` and the human gate
 * (`STELLAR_MAINNET_ALLOW=true`) is not set, this throws a typed error so
 * routes surface a 403-shaped response rather than accidentally moving real
 * funds.
 *
 * On testnet this is a no-op — the whole point is that pre-Phase-5 work
 * runs unhindered on testnet while mainnet stays behind a human gate per
 * the phase plan (Days 56-65, D7).
 *
 * `context` is a short human-readable label (e.g. "settlement submit",
 * "friendbot funding", "SDP disbursement") included in the thrown error
 * so the offending call site is obvious in logs.
 */
export function assertMainnetAllowed(context: string): void {
  if (env.network !== 'mainnet') return;
  if (env.mainnetAllow) return;
  const e = new Error(
    `Refusing to run "${context}" on mainnet without STELLAR_MAINNET_ALLOW=true. ` +
      `Mainnet transactions are human-gated per the phase plan — set the flag ` +
      `only after treasury key ceremony sign-off.`,
  ) as Error & { status: number; name: string };
  e.status = 403;
  e.name = 'MainnetGateClosed';
  throw e;
}

/** True when Friendbot funding is safe (testnet only, mainnet has no Friendbot). */
export function friendbotAvailable(): boolean {
  return env.network === 'testnet';
}
