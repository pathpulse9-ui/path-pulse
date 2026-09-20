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

create table if not exists wallet_users (
  address text primary key,
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

alter table payout_batches add column if not exists provider text;
alter table payout_batches add column if not exists sandbox boolean;
alter table payout_batches add column if not exists status text;
alter table payout_batches add column if not exists total_amount text;
alter table payout_batches add column if not exists receipts jsonb;
alter table payout_batches add column if not exists updated_at timestamptz;

create table if not exists group_payout_batches (
  id text primary key,
  payout_batch_id text,
  disbursement_id text,
  asset_code text not null,
  asset_issuer text,
  total_amount text not null,
  source_address text,
  memo text,
  network text not null,
  receipts jsonb not null default '[]'::jsonb,
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

-- Settlement indexer: persists every executed batch so the gov dashboard,
-- CSV/PDF exports, and Horizon-verifiable audit trail survive restarts and
-- serve production query load. Column order mirrors the SettlementBatch
-- contract; driver_payouts is jsonb for the variable-length array.
create table if not exists settlement_batches (
  id text primary key,
  created_at timestamptz not null default now(),
  network text not null,
  gross_amount text not null,
  asset_code text not null,
  asset_issuer text,
  authorities_amount text not null,
  driver_rewards_amount text not null,
  treasury_amount text not null,
  source_address text,
  authorities_address text,
  driver_pool_address text,
  treasury_address text,
  tx_hash text not null,
  horizon_url text,
  payout_batch_id text,
  driver_payouts jsonb not null default '[]'::jsonb
);

create index if not exists settlement_batches_created_at_idx on settlement_batches (created_at desc);
create index if not exists settlement_batches_network_idx on settlement_batches (network);
create index if not exists settlement_batches_asset_idx on settlement_batches (asset_code);

-- PAT-75: per-driver Carret sub-account mapping. Replaces the shared audit
-- account with a one-to-one link between a PathPulse user (userId from
-- session) and their own Carret sub-account.
create table if not exists carret_subaccounts (
  user_id text primary key,
  carret_account_id text not null unique,
  reference_id text,
  kyc_status text not null default 'pending',
  wallet_whitelisted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Email a sub-account was registered with. Idempotent add for prod rollout
-- (existing rows stay NULL until they see an update). Indexed for the
-- lower(email) lookup in getMappingByEmail.
alter table carret_subaccounts add column if not exists email text;
alter table carret_subaccounts add column if not exists phone text;
create index if not exists carret_subaccounts_email_lower_idx on carret_subaccounts (lower(email));
create index if not exists carret_subaccounts_phone_idx on carret_subaccounts (phone);
-- Drop the accidental UNIQUE on carret_account_id — many userIds can
-- legitimately point at the same Carret account (that's the whole
-- point of cross-session resume: same driver, new install / cookie,
-- same account_id). Kept as a plain index for lookup speed.
alter table carret_subaccounts drop constraint if exists carret_subaccounts_carret_account_id_key;
create index if not exists carret_subaccounts_carret_account_id_idx on carret_subaccounts (carret_account_id);

-- PAT-77: idempotency-key cache. Any money-moving POST that presents an
-- Idempotency-Key gets its response frozen here for 24h so a client retry
-- returns the cached response instead of double-spending.
create table if not exists idempotency_keys (
  key text primary key,
  request_hash text not null,
  status_code int not null,
  response_json jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idempotency_keys_created_at_idx on idempotency_keys (created_at);

-- PAT-80: per-Carret-sub-account daily usage counter. Carret caps every
-- activity type at ₹30K/day per sub-account (deposit INR, withdraw INR,
-- deposit crypto, withdraw crypto). We track usage in IST buckets so:
--   1. We can refuse over-limit sessions upfront (better UX than Carret
--      bouncing at the last moment)
--   2. UIs can surface "₹18,500 available today" chips
-- Reset happens naturally by ymd_ist being part of the PK — a new day is a
-- new row.
create table if not exists carret_daily_usage (
  carret_account_id text not null,
  activity text not null,
  ymd_ist date not null,
  amount_inr numeric(20, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (carret_account_id, activity, ymd_ist)
);

create table if not exists off_ramp_sessions (
  id text primary key,
  user_id text not null,
  provider text not null,
  sandbox boolean not null default false,
  status text not null,
  amount text not null,
  asset_code text not null,
  asset_issuer text,
  fiat_currency text not null,
  fiat_amount_estimate text,
  settlement_batch_id text,
  interactive_url text,
  anchor_account text,
  merchant_transaction_id text,
  stellar_tx_hash text,
  carret_order_id text,
  carret_quote_id text,
  carret_deposit_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists off_ramp_sessions_user_idx on off_ramp_sessions (user_id, created_at desc);
create index if not exists off_ramp_sessions_batch_idx on off_ramp_sessions (settlement_batch_id);
create index if not exists off_ramp_sessions_order_idx on off_ramp_sessions (carret_order_id);
create index if not exists off_ramp_sessions_status_idx on off_ramp_sessions (status, created_at);

create table if not exists off_ramp_status_events (
  id bigserial primary key,
  session_id text not null,
  previous_status text,
  status text not null,
  source text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists off_ramp_status_events_session_idx on off_ramp_status_events (session_id, id);

-- D6 score feed: PulseGen validation results and their provenance.
-- A score is only trustworthy if you can say where it came from, so every
-- batch records its supplier, when it arrived, who imported it and a hash of
-- the exact payload. Scores are append-only history; the newest row per
-- driver is the current one.
create table if not exists score_imports (
  id text primary key,
  supplier text not null,
  source_ref text,
  payload_sha256 text not null,
  score_count int not null,
  imported_by text not null,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  notes text
);

create index if not exists score_imports_received_at_idx on score_imports (received_at desc);

create table if not exists driver_scores (
  id bigserial primary key,
  driver_id text not null,
  score numeric(9, 8) not null,
  scored_at timestamptz not null,
  source text not null,
  import_id text references score_imports (id),
  created_at timestamptz not null default now(),
  constraint driver_scores_score_range check (score >= 0 and score <= 1)
);

create unique index if not exists driver_scores_unique_idx on driver_scores (driver_id, scored_at, source);
create index if not exists driver_scores_latest_idx on driver_scores (driver_id, scored_at desc);

-- D6 audit trail: which transaction gave a driver their badge, and the score
-- that justified it. Without this the assignment tx exists only in the API
-- response and is lost on reload, so "why does this driver earn 1.5x" has no
-- durable answer.
create table if not exists scout_assignments (
  id bigserial primary key,
  driver_id text not null,
  address text not null,
  tier int not null,
  multiplier numeric(4, 2) not null,
  score numeric(9, 8),
  score_source text,
  score_import_id text,
  asset_code text not null,
  issuer text not null,
  tx_hash text not null,
  horizon_url text,
  created_at timestamptz not null default now()
);

create index if not exists scout_assignments_driver_idx on scout_assignments (driver_id, created_at desc);
create index if not exists scout_assignments_created_idx on scout_assignments (created_at desc);
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
