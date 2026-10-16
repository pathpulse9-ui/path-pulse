import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export type AlertSeverity = 'critical' | 'warning' | 'resolved';

export interface Alert {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
}

export type AlertDelivery = 'sent' | 'deduped' | 'disabled' | 'failed';

export interface AlertRecord extends Alert {
  at: string;
  delivery: AlertDelivery;
}

export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const RECENT_LIMIT = 50;
const lastSent = new Map<string, number>();
const recent: AlertRecord[] = [];

export function recentAlerts(): AlertRecord[] {
  return [...recent];
}

function record(alert: Alert, now: number, delivery: AlertDelivery): AlertDelivery {
  if (delivery === 'deduped') return delivery;
  recent.unshift({ ...alert, at: new Date(now).toISOString(), delivery });
  recent.length = Math.min(recent.length, RECENT_LIMIT);
  return delivery;
}

export function formatAlert(alert: Alert): string {
  const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟠' : '🟢';
  const head = `${icon} [PathPulse ${env.network}] ${alert.title}`;
  return alert.detail ? `${head}\n${alert.detail}` : head;
}

export async function sendAlert(alert: Alert, now = Date.now()): Promise<AlertDelivery> {
  return record(alert, now, await deliver(alert, now));
}

async function deliver(alert: Alert, now: number): Promise<AlertDelivery> {
  logger.warn({ alert }, 'alert raised');
  if (!env.alerts.webhookUrl) return 'disabled';
  const dedupeKey = `${alert.key}:${alert.severity}`;
  const previous = lastSent.get(dedupeKey);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return 'deduped';
  lastSent.set(dedupeKey, now);
  const text = formatAlert(alert);
  try {
    const res = await fetch(env.alerts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'alert webhook rejected the alert');
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    logger.error({ err: e }, 'alert webhook unreachable');
    return 'failed';
  }
}

export function sendAlertInBackground(alert: Alert): void {
  void sendAlert(alert);
}

export function _resetAlertsForTests(): void {
  lastSent.clear();
  recent.length = 0;
}
