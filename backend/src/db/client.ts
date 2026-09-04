import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not configured — managed wallets require a database');
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.databaseUrl });
    pool.on('error', (e) => logger.error({ err: e }, 'postgres pool error'));
  }
  return pool;
}

const SCHEMA = `
create table if not exists users (
  email text primary key,
  user_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists payout_batches (
  id text primary key,
  disbursement_id text,
  settlement_batch_id text,
  asset_code text not null,
  asset_issuer text,
  created_at timestamptz not null default now()
);

create table if not exists payout_attempts (
  id bigserial primary key,
  batch_id text not null,
  disbursement_id text,
  step text not null,
  attempt int not null,
  outcome text not null,
  error text,
  duration_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists payout_attempts_batch_idx on payout_attempts (batch_id, id);

create table if not exists managed_wallets (
  user_id text primary key,
  public_key text not null unique,
  sealed_seed text not null,
  provisioned boolean not null default false,
  network text not null,
  created_at timestamptz not null default now()
);
`;

export async function migrate(): Promise<void> {
  await db().query(SCHEMA);
  logger.info('database schema ready');
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
