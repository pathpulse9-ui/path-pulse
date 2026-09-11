import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../server.js';
import { migrate } from '../db/client.js';

export async function startTestApi(): Promise<{ server: Server; base: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await migrate();
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (lastErr) throw lastErr;

  const server = createServer().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

export async function stopTestApi(server?: Server): Promise<void> {
  if (server) await new Promise<void>((r) => server.close(() => r()));
}
