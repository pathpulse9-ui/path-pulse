import { sendAlertInBackground } from './alerts.js';

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IDENTITY = 5;
const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

interface FailureState {
  times: number[];
  strikes: number;
  lockedUntil: number;
  lastStrikeAt: number;
}

const failures = new Map<string, FailureState>();

function stateFor(key: string, now: number): FailureState {
  let state = failures.get(key);
  if (!state) {
    if (failures.size >= MAX_TRACKED_KEYS) sweep(now, true);
    state = { times: [], strikes: 0, lockedUntil: 0, lastStrikeAt: 0 };
    failures.set(key, state);
  }
  state.times = state.times.filter((t) => now - t < LOCKOUT_WINDOW_MS);
  return state;
}

function sweep(now: number, force = false): void {
  for (const [key, state] of failures) {
    const idle = now >= state.lockedUntil && now - state.lastStrikeAt >= MAX_LOCKOUT_MS;
    const quiet = state.times.every((t) => now - t >= LOCKOUT_WINDOW_MS);
    if (idle && quiet) failures.delete(key);
  }
  while (force && failures.size >= MAX_TRACKED_KEYS) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

const sweeper = setInterval(() => sweep(Date.now()), SWEEP_INTERVAL_MS);
sweeper.unref?.();

export function isLockedOut(gate: string, identity: string, now = Date.now()): boolean {
  const state = failures.get(`${gate}:${identity}`);
  return !!state && now < state.lockedUntil;
}

export function recordFailure(gate: string, identity: string, now = Date.now()): void {
  const state = stateFor(`${gate}:${identity}`, now);
  state.times.push(now);
  if (state.times.length < MAX_FAILURES_PER_IDENTITY) return;
  state.strikes += 1;
  state.times = [];
  state.lastStrikeAt = now;
  state.lockedUntil = now + Math.min(LOCKOUT_WINDOW_MS * 2 ** (state.strikes - 1), MAX_LOCKOUT_MS);
  sendAlertInBackground({
    key: `lockout:${gate}`,
    severity: 'critical',
    title: `${gate} passcode locked out after repeated failures`,
    detail: `lockout strike ${state.strikes}`,
  });
}

export function clearFailures(gate: string, identity: string): void {
  failures.delete(`${gate}:${identity}`);
}

export function _resetLoginGuardForTests(): void {
  failures.clear();
}
