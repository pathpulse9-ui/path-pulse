import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

export function keyFromEnv(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  assertKey(key);
  return key;
}

export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function seal(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${VERSION}.${payload.toString('base64')}`;
}

export function unseal(sealed: string, key: Buffer): string {
  assertKey(key);
  const separator = sealed.indexOf('.');
  if (separator === -1 || sealed.slice(0, separator) !== VERSION) {
    throw new Error('Malformed sealed value: unsupported version');
  }
  const payload = Buffer.from(sealed.slice(separator + 1), 'base64');
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed sealed value: truncated payload');
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
