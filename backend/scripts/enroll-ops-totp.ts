import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateTotpSecret } from '../src/services/totp.js';

const OUT = resolve(import.meta.dirname, '../../secrets/ops-totp.json');

function main() {
  const identities = process.argv.slice(2).map((s) => (s.includes('@') ? s.trim().toLowerCase() : s.trim()));
  if (!identities.length) {
    console.error('usage: pnpm tsx scripts/enroll-ops-totp.ts <operator email or wallet address> [...]');
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const existing: Record<string, { secret: string; otpauth: string }> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  for (const identity of identities) {
    const secret = generateTotpSecret();
    const label = encodeURIComponent(`PathPulse ops:${identity}`);
    existing[identity] = {
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=PathPulse&algorithm=SHA1&digits=6&period=30`,
    };
  }
  writeFileSync(OUT, JSON.stringify(existing, null, 2), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  console.log(`Wrote ${identities.length} enrolment(s) to ${OUT} (mode 0600).`);
  console.log('Give each operator their otpauth URI privately, then set OPS_TOTP_SECRETS to identity=secret pairs.');
}

main();
