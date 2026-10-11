import http2 from 'node:http2';
import jwt from 'jsonwebtoken';
import { JWT } from 'google-auth-library';
import { env, apnsLive, fcmLive } from '../config/env.js';
import { db } from '../db/client.js';
import { logger } from '../config/logger.js';
import type { PushPlatform } from '@pathpulse/contract';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface Device {
  token: string;
  platform: PushPlatform;
}

type SendOutcome = 'sent' | 'stale' | 'failed';

const memoryDevices = new Map<string, { userId: string; platform: PushPlatform }>();

export async function registerDevice(userId: string, token: string, platform: PushPlatform): Promise<void> {
  if (!env.databaseUrl) {
    memoryDevices.set(token, { userId, platform });
    return;
  }
  await db().query(
    `insert into push_devices (token, user_id, platform, updated_at)
     values ($1, $2, $3, now())
     on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()`,
    [token, userId, platform],
  );
}

export async function unregisterDevice(userId: string, token: string): Promise<void> {
  if (!env.databaseUrl) {
    if (memoryDevices.get(token)?.userId === userId) memoryDevices.delete(token);
    return;
  }
  await db().query('delete from push_devices where token = $1 and user_id = $2', [token, userId]);
}

async function devicesFor(userId: string): Promise<Device[]> {
  if (!env.databaseUrl) {
    return [...memoryDevices.entries()]
      .filter(([, d]) => d.userId === userId)
      .map(([token, d]) => ({ token, platform: d.platform }));
  }
  const res = await db().query('select token, platform from push_devices where user_id = $1', [userId]);
  return res.rows as Device[];
}

async function forgetToken(token: string): Promise<void> {
  if (!env.databaseUrl) {
    memoryDevices.delete(token);
    return;
  }
  await db().query('delete from push_devices where token = $1', [token]);
}

let apnsToken: { value: string; issuedAt: number } | null = null;

function apnsAuthToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (apnsToken && now - apnsToken.issuedAt < 50 * 60) return apnsToken.value;
  const value = jwt.sign({ iss: env.push.apns.teamId, iat: now }, env.push.apns.privateKey, {
    algorithm: 'ES256',
    keyid: env.push.apns.keyId,
  });
  apnsToken = { value, issuedAt: now };
  return value;
}

function sendApns(token: string, message: PushMessage): Promise<SendOutcome> {
  const host = env.push.apns.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
    ...(message.data ?? {}),
  });
  return new Promise((resolve) => {
    const client = http2.connect(host);
    client.on('error', (e) => {
      logger.warn({ err: e }, 'apns connection failed');
      resolve('failed');
    });
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsAuthToken()}`,
      'apns-topic': env.push.apns.bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('close', () => {
      client.close();
      if (status === 200) return resolve('sent');
      const reason = (() => {
        try {
          return (JSON.parse(body) as { reason?: string }).reason ?? '';
        } catch {
          return '';
        }
      })();
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') return resolve('stale');
      logger.warn({ status, reason }, 'apns send failed');
      resolve('failed');
    });
    req.end(payload);
  });
}

let fcmClient: JWT | null = null;

async function sendFcm(token: string, message: PushMessage): Promise<SendOutcome> {
  fcmClient ??= new JWT({
    email: env.push.fcm.clientEmail,
    key: env.push.fcm.privateKey,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const { token: accessToken } = await fcmClient.getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.push.fcm.projectId}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: message.data ?? {},
        android: { priority: 'high' },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return 'sent';
  const text = await res.text().catch(() => '');
  if (res.status === 404 || text.includes('UNREGISTERED')) return 'stale';
  logger.warn({ status: res.status, body: text.slice(0, 300) }, 'fcm send failed');
  return 'failed';
}

async function sendToDevice(device: Device, message: PushMessage): Promise<SendOutcome | 'disabled'> {
  if (device.platform === 'ios') return apnsLive ? sendApns(device.token, message) : 'disabled';
  return fcmLive ? sendFcm(device.token, message) : 'disabled';
}

export async function notifyUser(userId: string, message: PushMessage): Promise<void> {
  const devices = await devicesFor(userId);
  for (const device of devices) {
    const outcome = await sendToDevice(device, message).catch((e) => {
      logger.warn({ err: e, platform: device.platform }, 'push send threw');
      return 'failed' as const;
    });
    if (outcome === 'stale') await forgetToken(device.token);
  }
}

export function notifyUserInBackground(userId: string, message: PushMessage): void {
  notifyUser(userId, message).catch((e) => logger.warn({ err: e, userId }, 'push notify failed'));
}
