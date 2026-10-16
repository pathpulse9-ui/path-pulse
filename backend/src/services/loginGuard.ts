import { sendAlertInBackground } from './alerts.js';

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IDENTITY = 5;
export const MAX_FAILURES_GLOBAL = 50;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((t) => now - t < LOCKOUT_WINDOW_MS);
  failures.set(key, kept);
  return kept;
}

export function isLockedOut(gate: string, identity: string, now = Date.now()): boolean {
  return (
    recent(`${gate}:${identity}`, now).length >= MAX_FAILURES_PER_IDENTITY ||
    recent(`${gate}:*`, now).length >= MAX_FAILURES_GLOBAL
  );
}

export function recordFailure(gate: string, identity: string, now = Date.now()): void {
  const own = recent(`${gate}:${identity}`, now);
  own.push(now);
  const all = recent(`${gate}:*`, now);
  all.push(now);
  if (own.length === MAX_FAILURES_PER_IDENTITY || all.length === MAX_FAILURES_GLOBAL) {
    sendAlertInBackground({
      key: `lockout:${gate}`,
      severity: 'critical',
      title: `${gate} passcode locked out after repeated failures`,
      detail: own.length === MAX_FAILURES_PER_IDENTITY ? `identity ${identity}` : 'global failure threshold reached',
    });
  }
}

export function clearFailures(gate: string, identity: string): void {
  failures.delete(`${gate}:${identity}`);
}

export function _resetLoginGuardForTests(): void {
  failures.clear();
}
