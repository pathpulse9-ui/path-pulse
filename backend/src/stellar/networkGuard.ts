import { env } from '../config/env.js';

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

export function friendbotAvailable(): boolean {
  return env.network === 'testnet';
}
