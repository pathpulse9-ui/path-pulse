# PathPulse — Operational Runbook

> Phase 6 handover artifact. Day-2 operations for the deployed demo
> (`demo.pathpulse.ai` / `demo-api.pathpulse.ai`, AWS App Runner). Pairs with
> [`ARCHITECTURE.md`](ARCHITECTURE.md) (system shape), [`API_ARCHITECTURE.md`](API_ARCHITECTURE.md)
> (endpoint/error catalog) and [`MAINNET_CUTOVER.md`](MAINNET_CUTOVER.md) (one-time cutover,
> not day-2 ops).

## Deploy, verify, rollback

All of this is scripted in the root `Makefile` — read `make help` before doing anything by hand.

| Task | Command |
|---|---|
| Deploy both services | `make deploy` |
| Deploy one service | `make deploy-api` / `make deploy-web` |
| Push env vars without a rebuild | `make env` |
| Check deployed image + service status | `make status` |
| Hit live health/routing endpoints | `make verify` |
| Roll back | `make rollback-api TAG=<sha>` / `make rollback-web TAG=<sha>` |

`make deploy` runs `make check` first (typecheck + build + backend tests) unless `CHECK=0` is
passed — don't skip it on a real deploy. Image tags are git short-SHAs; `make status` shows
which SHA is live, so a bad deploy is always `make rollback-* TAG=<previous-sha>` away.

## Health checks

- `GET /health` — `{ status, network, horizon, version }`. If this doesn't return `200`, the
  process is down or crash-looping; check App Runner logs before anything else.
- `GET /v1/treasury/config` and `GET /v1/accounts/distribution` — confirm the deployed backend
  is pointed at the network/accounts you expect (`network` field, public keys). A demo pointed
  at the wrong network is the most likely cause of "why is the dashboard empty."
- `make verify` runs the above plus a routing quote and the web app's `/` and `/signin`.

## QA / regression scripts

Phase 6 exit criteria call for an E2E regression and load tests on the settlement path. Both
are runnable scripts (not part of `npm test` — they hit real testnet Horizon and, for the
E2E flow, Carret's dev tenant):

| Script | What it checks |
|---|---|
| `node scripts/e2e-flow.mjs [--base <url>]` | Full flow: guest onboarding → Friendbot-funded driver → 50/30/20 settlement batch (real testnet tx) → batch retrievable by id and in the indexer list → CSV export and PDF receipt both reflect it → off-ramp withdrawal session created and linked back to the batch. Exits non-zero on any failed step. |
| `node scripts/load-test-settlement.mjs [--requests 200] [--concurrency 20] [--with-writes]` | Concurrency load on `GET /v1/settlement/batches` and the CSV export (read path, safe to re-run); `--with-writes` additionally fires a concurrent burst of real settlement submits to check the source account's Horizon sequence number doesn't corrupt under concurrent writes. |
| `node scripts/mainnet-smoke-check.mjs --network mainnet` | Read-only mainnet-cutover check — see "Deploy, verify, rollback" above and `MAINNET_CUTOVER.md`. |

Run `e2e-flow.mjs` and `load-test-settlement.mjs` (read-only mode) against staging before any
production cutover, and after any change to `stellar/settlement.ts`, `settlementStore.ts`, or
the off-ramp provider wiring.

Not yet covered by any script: a security pass on external surfaces (the Phase 6 QA scope also
calls for this) and the Android/iOS legs of the same flow — those remain manual/mobile-team work.

## Authorisation model

Three tiers:

| Tier | How you get it | What it opens |
|---|---|---|
| anonymous | — | public reads: `/health`, distribution accounts, treasury config, settlement list, CSV export, PDF receipts |
| session (`google` / `wallet` / `guest`) | sign in, or `POST /v1/auth/guest` | your own records: off-ramp sessions, Carret KYC, `/v1/tx/build`, `/v1/routing/swap` |
| **`ops`** | `POST /v1/auth/ops/login` with `OPS_PASSCODE` | everything that moves protocol funds: settlement batches, group payouts, SDP fan-out, SCOUT issuance, treasury reconfiguration |

Anonymous callers get `401` (authenticate); a valid non-ops session gets `403` (known, still not
permitted) — so a signed-in driver cannot trigger a settlement. In the web app, operators
authenticate through the **Ops access** control in the dashboard top bar.

`partner` (`GOV_PARTNER_PASSCODE`) is a separate, parallel role for the `/gov` dashboard; it is
not an operator role and does not open the fund-moving endpoints.

Residual gaps, both out of scope of the current pass:
- **Carret KYC IDOR.** The KYC routes take `account_id` from the request rather than resolving it
  from the caller's session mapping, so an authenticated caller can still act on another driver's
  Carret account. Anonymous access is closed; ownership binding is not.
- **Idempotency keys are global and advisory.** Not scoped per user, skipped entirely when the
  header is absent, and two concurrent requests with the same key both execute (the cache row is
  written after the handler). `API_ARCHITECTURE.md` claims the header is required on value-moving
  POSTs; it is not enforced.

## Rate limits

`middleware/rateLimit.ts`, two buckets: credential routes (partner + ops passcodes, Google/SEP-10
verify, guest) at 20 per 15 min, and all other mutating requests at 60/min. GETs are exempt so
the gov dashboard and indexer stay unthrottled, as is `/v1/offramp/callback` — provider
webhooks are signature-verified already and throttling them would strand withdrawals.

Two operational caveats:
- Counters are **per-process and in-memory**. This only works because App Runner autoscaling is
  pinned to one instance; a second instance doubles every effective limit. Scaling past one
  instance requires a shared store (Redis) first.
- `trust proxy` is set to 1 so limits key on the real client IP from `X-Forwarded-For`. If the
  number of proxy hops in front of the service ever changes, that value must change with it, or
  every request will be attributed to the proxy and one caller can lock out everyone.

## Mainnet preflight

The backend refuses to boot on `STELLAR_NETWORK=mainnet` with a bad config, listing every
problem at once: dev signer backend, `aws-kms` without `KMS_KEY_ID`, missing `DATABASE_URL`
(which would silently put settlements in the in-memory store), any unset distribution account,
missing `SESSION_SECRET` / `OPS_PASSCODE`, or `CARRET_ALLOW_TESTNET=true`. A mainnet deploy that
starts is one someone will send funds through, so these fail closed rather than warn.

## Data dependency: DATABASE_URL

`DATABASE_URL` is **required** for managed wallets (`db/client.ts` throws without it — driver
seeds have nowhere durable to live). Settlement batches (`stellar/settlementStore.ts`) degrade
gracefully to an in-memory array when it's unset, which is fine for a laptop demo and **wrong
for the deployed environment** — an App Runner restart or redeploy would silently drop every
settlement batch. Deployed environments must have `DATABASE_URL` set; `make status` won't tell
you this is missing, only `GET /v1/settlement/batches` quietly returning fewer rows than
expected after a restart will.

## Common failure modes

| Symptom | Likely cause | What to check |
|---|---|---|
| `POST /v1/settlement/batches` → `HorizonRejected` (422) | Settlement source underfunded, sequence number race, or a bad asset/issuer pair | The `result_codes` in the error body; source account balance on Horizon |
| `POST /v1/settlement/batches` / any mainnet write → `MainnetGateClosed` (403) | `STELLAR_MAINNET_ALLOW` is not `true` while `STELLAR_NETWORK=mainnet` | This is the human gate working as designed (see `MAINNET_CUTOVER.md`) — not a bug unless mainnet ops were expected to be live |
| Off-ramp session stuck in `pending_anchor` / `pending_user_transfer_start` | Carret/Ramp webhook never arrived, or arrived with a bad signature | `POST /v1/offramp/callback` fails closed (`InvalidSignature`, 401) by design — check `CARRET_WEBHOOK_SECRET` / `RAMP_WEBHOOK_PUBLIC_KEY` match the provider dashboard; the orphan reconciler (`services/orphanReconciler.ts`, `CARRET_RECONCILER_INTERVAL_MS`, default 60s) polls Carret directly for sessions stuck > 30s **but only runs when `DATABASE_URL` and Carret live credentials are both set** |
| `POST /v1/routing/swap` fails for `stellarbroker` | Expected — `stellarbroker-provider.ts` can quote but `execute()` always throws `NotImplemented` (501). Aquarius is the only router that fills swaps today | Not an incident; don't page on it |
| KMS signing errors (`AwsKmsSigner`) | IAM permissions, wrong `KMS_KEY_ID`, or KMS region mismatch | `docs/KMS_VERIFICATION.md`; confirm the backend's IAM role has `kms:Sign` + `kms:GetPublicKey` on that key |
| `/gov/*` shows a passcode wall unexpectedly | `PartnerGate` working as designed | Confirm `GOV_PARTNER_PASSCODE` is set and shared with the partner, not that anything is broken |
| Settlement/payout data vanishes after a redeploy | `DATABASE_URL` unset in that environment | See "Data dependency" above |
| `POST /v1/settlement/batches` returns **502 `PayoutProviderUnavailable`** | The on-chain split succeeded but the payout provider (SDP) call failed — most often `SDP_BASE_URL` unreachable | Not data loss: the batch is persisted before the provider is called, and the error names the batch id and tx hash. Retry the fan-out with `POST /v1/ops/payouts/batches {"settlementBatchId":"stl_…"}` once SDP is reachable. A batch with no `payoutBatchId` is exactly this state |

## Monitoring & alerting

**Not yet wired as of this writing** (`docs/MAINNET_CUTOVER.md` pre-cutover checklist item
"Sentry DSN configured" is still open) — this is tracked as separate, in-progress work. Until
it lands, the only signal is `make verify` / manual `GET /health` polling and App Runner's own
service logs (`aws apprunner ...` / App Runner console). Once Sentry is wired, the
`MainnetGateClosed` → page-on-call rule in `MAINNET_CUTOVER.md` should be the first alert added.

## Rotating secrets

- **Session secret** (`SESSION_SECRET`): rotating invalidates every live session cookie
  (everyone signed out). Low blast radius — fine to do any time.
- **KMS key**: never delete a key that's an authorized signer on a live account. Add the new
  KMS-derived address as a signer first (`setOptions`), verify a signed tx with it, *then*
  remove the old signer. This is the same pattern used to introduce the current KMS signer —
  see `docs/KMS_VERIFICATION.md`.
- **Treasury signers**: human-gated by design. `POST /v1/treasury/multisig/build` returns the
  reconfiguration XDR for review; the backend never auto-signs it. See `MAINNET_CUTOVER.md`.
- **GOV_PARTNER_PASSCODE**: rotate by updating the env var and re-sharing the new passcode with
  partners out-of-band; existing `partner` session cookies keep working until they expire
  (7 days) since the passcode isn't checked again after login — expect a brief overlap window.

## Escalation

- Treasury / mainnet incidents: notify the treasury signers directly (see
  `MAINNET_CUTOVER.md` § Rollback) — this is a human-gated system by design, not a
  self-healing one.
- Everything else: repo issue + whoever owns the surface per `ARCHITECTURE.md`'s
  workstream table (Backend Core / Android / iOS / Web Platform).
