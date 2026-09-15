# Changelog

All notable changes to PathPulse are documented here.

## [0.1.15.0] — 2026-09-16

### Added (D6 — SCOUT issuance and revocation)
- **SCOUT badges issued on chain for the first time.** The issuer `GBKGCHRV…` had been created and flagged on 2026-08-27 but never used — its entire operation history was one `create_account` and two `set_options`, so no driver held a badge and "test drivers assigned SCOUT tiers visible in Stellar wallets" could not be demonstrated. Three drivers now hold one authorised badge each (`7bc2b08a…`, `cc573390…`, `e9705bd2…`), each also carrying an authorised USDC trustline so they can receive an SDP fan-out.
- **Tier revocation** (`revokeTier`, `POST /v1/scout/revoke`, ops-gated, plus a control on the SCOUT page). The issuer claws the asset back and de-authorises the trustline in one issuer-signed transaction; the driver falls back to the 1.0x multiplier with no action available to them. Proven end to end: issued SCOUT2 `375e85bc…` → revoked `64f1465e…` (1.0000000 clawed back) → on-chain tier reads `null`, multiplier 1.0x.
- **`backend/scripts/provision-scout-drivers.ts`** — runs the same on-chain sequence as `assignSampleTier()` but persists every driver seed before the first network call, and aborts if the resolved issuer is not the expected one. `assignSampleTier()` mints its driver with `Keypair.random()` and discards the secret, which is how the original driver pool `GD2J6WSB…` became permanently unusable.
- **Converted assets routed into the settlement pipeline.** Swap output landed in the AMM routing source and had never reached the settlement source, leaving conversion and distribution adjacent but unlinked. Closed: `bf4f8c62…` (convert) → `23b28191…` (6 USDC transfer) → `a6ba3f88…` (settled 1.5 / 0.9 / 0.6), batch `stl_1789498668104_c014232e`.
- **Score-feed contract for SCOUT tiers** (`services/pulsegen.ts`, `ValidationScore` in the contract package). PulseGen is an external dependency; the provider shape is now explicit and every score records its `source`, so a synthetic score can never be mistaken for one PulseGen issued. Synthetic is the agreed interim per the plan's risk register.

### Fixed
- **An unknown settlement batch id crashed the backend.** `services/offramp.ts` called `getSettlementBatch(req.settlementBatchId)` without `await`, so the validation never ran — an unknown id passed and the session was created anyway — and the rejected promise became an unhandled rejection that killed the process. Observed live: the request returned 200, then Node exited. Now awaited: unknown ids return **404** and the service stays up.
- **Carret's real error never reached the caller.** `extractHumanMessage` read the generic `error` key first and returned `"Validation failed"`, never looking at `details`, where Carret puts the actual sentence — and the two endpoints use different shapes (`details: [...]` on quotes, `details: {errors: [...]}` on orders). Both are handled now, so callers see `"Minimum amount is 10.00"` or `"Insufficient USDC balance. Required: 10.0, Available: 9.0"`.
- **`scripts/e2e-flow.mjs` could not pass.** It authenticated with `POST /v1/auth/guest` then called `POST /v1/settlement/batches`, which 0.1.14.0 moved behind `requireRole('ops')` — nine checks failed on a 403. It now signs in as an operator (`--ops`/`OPS_PASSCODE`) and additionally asserts that a guest is refused, turning the regression into a positive test of the authorisation boundary.
- **Errors surfaced as raw JSON.** `apiFetch` stringified the response body into the error message, so the UI showed `Request failed (422): {"error":…,"requestId":64}`. It now throws a typed `ApiError` carrying `status`, `needsAuth` and `needsOperator`, rendered by a new `ErrorNotice` component — a 403 reads "Operator access required" with a pointer to Ops access rather than a red line of JSON.
- **The KYC tab overlapped the sidebar.** The page was built as a phone wizard and kept `fixed left-0 right-0 bottom-0` on its action bar, which positions against the viewport rather than the content column. Now `sticky` inside a `max-w-3xl` block, matching the other dashboard tabs.

## [0.1.14.0] — 2026-09-11

### Added (Phase 5 — D7 mainnet readiness)
- **Operator role.** New `ops` session method (`POST /v1/auth/ops/login`, `OPS_PASSCODE`, constant-time compare) and a `requireRole()` middleware. The six endpoints that move protocol funds — settlement batches, group payouts, SDP fan-out, SCOUT issuance, SCOUT revocation, treasury reconfiguration — require it: anonymous → `401`, any valid non-ops session → `403`. This closes the gap left by the previous pass, where `POST /v1/auth/guest` minted an unverified session that satisfied every check. Web: an **Ops access** control in the dashboard top bar.
- **Mainnet preflight.** The backend refuses to boot on `STELLAR_NETWORK=mainnet` when the config would fail quietly — dev signer backend, `aws-kms` without `KMS_KEY_ID`, missing `DATABASE_URL` (settlements would silently land in the in-memory store), any unset distribution account, missing `SESSION_SECRET`/`OPS_PASSCODE`, or `CARRET_ALLOW_TESTNET=true`. All problems are reported at once rather than one per restart.

### Fixed
- **A failed payout could lose a settled batch.** `executeSettlementBatch` submitted the 50/30/20 split on-chain, then called the payout provider, then persisted the record — so a provider failure in between left funds moved with no indexer row. The batch is now written the moment the on-chain split confirms (`saveBatch` precedes `createPayoutBatch`); a provider failure returns `502 PayoutProviderUnavailable` naming the batch id and tx hash, retryable via `POST /v1/ops/payouts/batches`.
- `SettlementBatch.payoutBatchId` is now optional in the contract — absent means the split settled but the fan-out has not completed, which is a real and recoverable state.

## [0.1.13.0] — 2026-09-11

### Security (Phase 5 — D7 security review)
- **Anonymous callers could move money.** `POST /v1/settlement/batches`, `/v1/settlement/group-payouts`, `/v1/ops/payouts/batches`, `/v1/scout/assign` and `/v1/treasury/multisig/build` had no session check of any kind — the group-payout endpoint accepted arbitrary destination addresses and amounts, 100 per call, from the public internet. All now behind `middleware/requireSession.ts`; anonymous requests get `401` before validation or business logic. Regression tests assert the 401 for each.
- **Off-ramp sessions leaked across drivers.** `GET /v1/offramp/sessions` returned every user's withdrawals (amounts, fiat estimates, anchor accounts, provider order ids) to an unauthenticated caller, and `:id` had no ownership check. Sessions are now scoped by `ppUserId`; a session owned by someone else reports 404 rather than 403, so the endpoint does not confirm the id exists. `POST` no longer falls back to a shared `sandbox-user` identity.
- **Carret KYC/PII endpoints were an unauthenticated IDOR.** `GET /v1/carret/kyc/status/:accountId` returned a KYC-verified account's status and `kyc_session` to anyone; `kyc/document` and `kyc/cleanup` took the account id straight from the request. Anonymous access closed. Ownership binding — resolving the account from the caller's own mapping — remains open.
- **Rate limiting** (`middleware/rateLimit.ts`): 20 per 15 min on credential routes — `GOV_PARTNER_PASSCODE` was previously open to unlimited guessing — and 60/min on other writes. GETs and the signature-verified provider webhook are exempt. Counters are in-memory and therefore only correct while the service runs a single instance.
- **Security headers** via `helmet`, and `trust proxy` set to 1 so limits key on the real client IP.

### Fixed
- **USDC settlement was impossible and silently so.** The driver pool `GD2J6WSB…` was provisioned by a script that printed its seed to stdout only, so it could never sign a `changeTrust`, could never hold USDC, and since a settlement is one atomic transaction its operation failing took the whole settlement with it. Every prior D6 proof used XLM, which masked it. Replaced with `GAUI7XIA…` (funded, USDC trustline, secret persisted) via `backend/scripts/provision-driver-pool-v2.ts`. Proven: tx `4d123cc4…`, ledger 4618964, 3 USDC split 1.5 / 0.9 / 0.6.

## [0.1.12.0] — 2026-09-11

### Added (Phase 6 — Gov Gateway access control, QA scripts)
- **Partner access control on `/gov/*`.** New session method `partner` (`POST /v1/auth/partner/login`, checked against `GOV_PARTNER_PASSCODE` with a constant-time compare); `web/app/gov/PartnerGate.tsx` blocks the Government Settlement Gateway behind a passcode form until a `partner` session exists, `PartnerSignOut.tsx` clears it. The gate is page-level — the underlying `/v1/settlement/*`, `/v1/treasury/config` and `/v1/accounts/distribution` endpoints stay public reads because the driver-facing `/dashboard/*` pages share them.
- **QA scripts:** `scripts/e2e-flow.mjs` (onboarding → funded driver → 50/30/20 settlement → indexer/export/receipt → linked off-ramp withdrawal, against real testnet Horizon) and `scripts/load-test-settlement.mjs` (concurrency load on the indexer read path; `--with-writes` adds a concurrent settlement-submit burst).
- **`scripts/mainnet-smoke-check.mjs`** + `make mainnet-smoke` — read-only implementation of the manual smoke step for the mainnet cutover.
- `docs/API_ARCHITECTURE.md` endpoint catalog and the `SessionUser.method` union brought back in sync with what is actually live (Carret not Mercuryo, the Aquarius/StellarBroker aggregator, gov endpoints as page-gated reuse rather than a separate `/v1/gov/*` namespace, `guest`/`partner` session methods).

## [0.1.11.0] — 2026-08-27

### Added (custody — persistence + AWS KMS signer)
- **Driver keys are now encrypted at rest.** Managed wallet seeds are sealed with AES-256-GCM (`crypto/seal.ts`, format `v1.base64(iv‖tag‖ciphertext)`, fresh 12-byte IV per seal, auth tag verified on read) and stored in Postgres. Decryption happens at exactly one call site, inside `getManagedSigner`, only at signing time.
- **`users` table** maps email → user id, so a returning sign-in recovers its existing wallet. Persisting seeds alone kept the key safe while losing the pointer to it; both tables are required.
- **`AwsKmsSigner`** (`stellar/kms.ts`) — signs Stellar transactions with an Ed25519 key held in AWS KMS (`ECC_NIST_EDWARDS25519`, `ED25519_SHA_512` over `MessageType: RAW`). The key never enters the process. `createSigner()` is now async and selects it on `SIGNER_BACKEND=aws-kms`.
- **`SIGNER_BACKEND` reduced to `dev | aws-kms`.** The `gcp-kms` and `hsm` branches were declared but never implemented and are removed; AWS KMS keys are generated in and never leave AWS-managed HSM hardware, so a separate CloudHSM/PKCS#11 backend is not used. The switch is now exhaustive over two implemented backends.
- `SIGNER_BACKEND` is validated at boot against its legal values; `KMS_KEY_ID` is read into config; `dev` is rejected outright when `STELLAR_NETWORK=mainnet`, so a misconfigured mainnet deploy fails at startup rather than at the first signature.

### Fixed
- `createSigner()` was dead code — every signing path constructed `DevSigner` directly, so `SIGNER_BACKEND` selected nothing. All paths now route through the factory.
- `managed.ts` no longer calls `keypair.secret()`; signers are built from a `Keypair`, so no plaintext seed string is materialised in application code.
- Concurrent first sign-ins for one email no longer mint duplicate wallets or fail on duplicate Friendbot funding.

### Migrated
- **AWS KMS is live for protocol accounts.** `SIGNER_BACKEND=aws-kms`; the KMS-derived address `GAKYXUFDWZ6Q…` was added via `setOptions` as an authorized signer on all four service accounts (settlement, group payout, SCOUT issuer, AMM routing). Each account's original signer was left in place, so deleting the KMS key cannot strand an account. Live proof: tx `3b73c013dc1f7e1cc7f0dd57b6642421db4e87ddfd11b99c838c10de69c70c47` — signature hint matches the KMS key and verifies against it.
- `getManagedSigner` now selects per tier: service accounts route through `SIGNER_BACKEND`, per-user wallets always sign with their own sealed seed. Without this, `aws-kms` would have signed every driver's transaction with one key from the wrong address.

### Verified
- KMS end-to-end on testnet: tx `07dc33d4caa6a1a74c317c9c796c097c348baeaa7717e2595cb7ab0257d02cfb` (ledger 4358729, memo `kms-signed`), submitted from `GAKYXUFDWZ6Q…` — an address derived from the KMS public key, for which no seed exists. Record in `docs/KMS_VERIFICATION.md`.
- Persistence across a process boundary: same email in a fresh process returns the same user id and wallet; 10 concurrent calls yield 1 user row.
- 18/18 unit tests pass; `tsc` clean across contract, backend and web.

### Known limitations
- The key-encryption key is an environment variable, not KMS-held — this protects a leaked database, not a compromised process. *(Superseded — the KEK is now wrapped by AWS KMS (`alias/pathpulse-kek`) and unwrapped at startup, so KMS is the root of trust for every user key.)*
- App Runner must stay pinned to one instance: settlement batches, group payouts, payout batches, off-ramp sessions and wallet-auth users remain in process memory. *(Superseded — settlement batches and payout attempts are Postgres-backed as of 0.1.14.0; the single-instance requirement now stems from in-memory rate-limit counters, see 0.1.13.0.)*

## [0.1.10.0] — 2026-08-25

### Fixed (T1 review — delegated path was unreachable for end users)
- `ensureAccountForEmail` now provisions through `provisionManagedWallet()` instead of generating its own keypair. The Google email/OAuth flow and the delegated signer previously wrote to and read from **two disconnected in-memory stores**, so every Google user received a funded managed address whose transactions all returned 404. Nothing wrote an end user into the signer's store — `provisionManagedWallet()` was called only by the four internal service accounts.
- Stale 404 text on `/v1/tx/build` and `getManagedSigner` no longer directs callers to `POST /v1/onboard`, a route removed in the auth pivot.
- `buildTreasuryMultisigTx` (`backend/src/stellar/accounts.ts`) now sets `masterWeight: 0`, so a configured 3-signer set yields a 2-of-3 rather than counting the account's own master key as a fourth signer. The function is currently unreferenced by any route.

### Security
- **`POST /v1/tx/build` now requires a session** and derives the signing identity from it; a `userId` in the request body is ignored. It previously took `userId` straight from the body with no session check, so any unauthenticated caller who knew a user id — a value returned to the client by `/v1/auth/google/verify` — could have the backend delegate-sign an arbitrary payment out of that user's managed wallet. Reachable in practice only after the store-wiring fix above, since before it no end-user account existed in the signer's store. `/v1/tx/submit` is deliberately left ungated: it relays an already-signed envelope, which anyone can submit to Horizon directly.
- Contract: `BuildTransactionRequest` no longer requires `userId` on the wire.

### Added
- `docs/CUSTODY.md` — authoritative statement of custody model, signer-backend status, delegated-path auth, known limitations, and both treasury accounts. *(Since 2026-08-27 this is a local-only, gitignored working document; the public summary lives in `README.md` and `docs/KMS_VERIFICATION.md`.)*
- Replacement treasury `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` — master weight 0, three weight-1 signers, thresholds 2/2/2. Config tx `9f93fc82…0856`; two-signer proof `4face5e7…3722` (exactly 2 signatures).

### Changed (documentation accuracy — Privy substitution)
- **Privy is formally substituted, not deferred.** It is not integrated in any branch: no SDK, no API call, no credential. `docs/ARCHITECTURE.md`, `docs/PHASE_PLAN.md`, `docs/AWS_COST_AND_KEY_STORAGE.md`, `docs/API_ARCHITECTURE.md`, `ios/README.md` and `README.md` no longer present it as the mainnet plan; it survives only as one unselected option in the vendor cost comparison.
- Docs no longer imply KMS/HSM-backed signing is in service. The `aws-kms` / `gcp-kms` / `hsm` branches are declared and throw; the live signer is `dev` (`DevSigner`, in-memory) in every environment.
- `README.md` multisig claim corrected: the ≥ 2-of-3 description applies to the replacement treasury. The original `GADPEI5O…` shipped as **2-of-4** with the master key retained at weight 1 and its three signer secrets unrecoverable — it is permanently frozen and cannot authorize even a `set_options` to repair itself.

### Known limitations (unchanged, now documented)
- Managed keys remain in process memory with no persistence: any redeploy orphans every managed account created before it, permanently. *(Superseded by 0.1.11.0 — driver seeds are sealed with AES-256-GCM and persisted in Postgres; a redeploy no longer orphans a wallet.)*
- `secrets/treasury-v2.json` is not in a managed secret store. It is a single point of failure.
- The demo's distribution env vars still point at the original, frozen treasury; migration is outstanding. *(Superseded — the deployed service uses the replacement treasury `GBRXUTNC…`, partner revenue `GCGKQ2BL…` and driver pool `GAUI7XIA…`; see 0.1.13.0.)*

## [0.1.9.0] — 2026-08-13

### Added (PAT-11 · D4 — Carret Infra off-ramp provider, mocked-first)
- Introduced **Carret Infrastructure API** as an alternate `OffRampProvider` alongside Ramp. Corridor: **USDC on Stellar → INR** (native match for PathPulse's settlement asset — no USDC→XLM bridge hop required). Pure REST + `API-KEY` header, no widget/redirect.
- New `backend/src/services/carret.ts`: typed HTTP client covering `GET /supported_routes/`, `POST /offramp/quote/`, `POST /offramp/place_order/`, `GET /offramp/orders/{id}/`; status mapper (`open|partially_filled → pending_anchor`, `filled → completed`, `cancelled → error`); fail-closed HMAC-SHA256 webhook verifier for `X-Carret-Signature` (scheme TBD — placeholder until Carret confirms).
- New `carretMocks`: shape-accurate mocked responses so the full flow is demoable + testable pre-onboarding. Time-based order progression (`open` → `partially_filled` → `filled`).
- Provider selection via `OFFRAMP_PROVIDER=ramp|carret` (default `ramp`, so main is unchanged). `carretLive` toggle engages the real API the moment `CARRET_API_KEY` + `CARRET_ACCOUNT_ID` land.
- `applyCarretCallback(orderId, status)` correlates webhooks by Carret's `order_id` (Carret's payload doesn't carry our session id). Callback route now provider-shaped.
- Contract: `OffRampSession.provider` widened to `'ramp' | 'mercuryo' | 'carret'`.
- Env: `CARRET_API_KEY`, `CARRET_BASE_URL`, `CARRET_ACCOUNT_ID`, `CARRET_CRYPTO=USDC`, `CARRET_CHAIN=Stellar`, `CARRET_FIAT=INR`, `CARRET_BANK_ID`, `CARRET_WEBHOOK_SECRET`, `CARRET_INDICATIVE_RATE`, `OFFRAMP_PROVIDER`.

### Verified
- `tsc` clean (contract + backend). With `OFFRAMP_PROVIDER=carret` (no API key), sandbox flow: create session → returns `provider:'carret'`, `sandbox:true`, mocked `quote_id`/`order_id`, indicative INR estimate; polling advances through Carret's status vocabulary → `completed`.

> **Open (external — PAT-27):** Carret sandbox `API-KEY` for `dev.carret.in`, Partner Dashboard access to register the webhook URL, definitive webhook signature scheme, and the sub-account/KYC onboarding model (per-driver sub-accounts under PathPulse's main account). Ramp remains the default until Carret goes live.

## [0.1.8.0] — 2026-08-05

### Changed (PAT-11 · D4 — off-ramp switched Mercuryo → Ramp Network)
- Replaced the Mercuryo off-ramp with **Ramp Network** behind the same `OffRampProvider` interface. Ramp is **widget-based**: the backend builds a signed off-ramp **widget URL** (`enabledFlows=OFFRAMP`, `offrampAsset`, `userAddress`, `fiatCurrency`, `swapAmount`, `offrampWebhookV3Url` with a `ref` for correlation) that the driver opens; Ramp runs KYC + pays fiat to their bank.
- **Webhook** `POST /v1/offramp/callback` now verifies Ramp's **ECDSA `X-Body-Signature`** over the raw body (was Mercuryo HMAC) and applies status by the `ref` param. Removed `services/mercuryo.ts`; added `services/ramp.ts`.
- Corridor: **XLM on Stellar → INR** (Ramp off-ramps XLM; **INR is supported**, unlike Mercuryo. Note: Stellar-USDC is not in Ramp's off-ramp list — see below). Env: `RAMP_API_KEY`, `RAMP_WIDGET_URL`, `RAMP_WEBHOOK_PUBLIC_KEY`, `PUBLIC_API_URL`, `OFFRAMP_ASSET_ID=XLM_XLM`.
- Sandbox stub retained (active until `RAMP_API_KEY` is set); web copy updated.

### Verified
- Sandbox create (provider `ramp`, XLM→INR estimate). Live mode builds a correct `app.demo.ramp.network` off-ramp URL. Webhook: valid ECDSA `X-Body-Signature` → 200, invalid → 401; a `RELEASED` webhook drove the session to `completed`. `tsc` clean (contract, backend, web).

> ⚠️ **Corridor note:** Ramp off-ramps **XLM** (not Stellar-USDC). PathPulse settles in USDC, so drivers would convert USDC→XLM on Stellar (trivial via path payment/DEX) before off-ramping, or we use a USDC-supporting rail. INR off-ramp availability + KYC/countries to confirm during Ramp onboarding.

## [0.1.7.0] — 2026-08-05

### Added (PAT-14 · Phase 4 · D6 — SCOUT reputation assets)
- **SCOUT1/2/3 Classic Assets** (`backend/src/stellar/scout.ts`) issued by a protocol issuer with **AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED**. Tier assignment from a **PulseGen validation score** (synthetic: ≥0.8→SCOUT3, ≥0.5→SCOUT2, else SCOUT1) via trustline → issuer-authorize → badge payment; on-chain tier lookup.
- **Settlement engine now reads reputation on-chain** — each driver's SCOUT badge sets the multiplier (1.0/1.2/1.5×), overriding the request's tier field.
- Endpoints: `GET /v1/scout` (issuer+tiers), `POST /v1/scout/assign` (score→badge), `GET /v1/scout/{address}` (on-chain tier); contract types + OpenAPI.
- Web **SCOUT** console page (`web/app/scout/page.tsx`): issuer/tiers, assign-a-tier, tier lookup; added to `ConsoleHeader`.

### Verified (testnet)
- Issuer flags = auth_required + auth_revocable + auth_clawback_enabled on Horizon; drivers hold **authorized** SCOUT badges. Assign 0.3/0.6/0.9 → SCOUT1/2/3. A settlement passing all drivers as `tier:1` still paid 1.0/1.2/1.5× — proving tiers are read from chain, not input. `tsc` clean; production web build clean.

> Remaining on PAT-14: Android/iOS SCOUT tier-badge UI (mobile — Daiwik). The assets + API are ready for it.

## [0.1.6.0] — 2026-08-03

### Added (PAT-11 · Phase 3 · D4 — Mercuryo off-ramp)
- Off-ramp orchestration behind an `OffRampProvider` interface (`backend/src/services/offramp.ts`): in-memory session index, optional link to a settlement batch (validated → 404 if unknown).
- **Mercuryo B2B REST client** (`backend/src/services/mercuryo.ts`) implementing the real off-ramp flow per the v1.6 spec: `sign-in`/`sign-up` (Sdk-Partner-Token) → `GET /b2b/oor/sell-rates` (trx_token) → `POST /b2b/oor/sell` (hosted redirect) → status via `GET /b2b/transactions`. Mercuryo is a **card-based** ramp, **not** a Stellar SEP-24 anchor — the integration was corrected to match.
- **Callback webhook** `POST /v1/offramp/callback` verifying the `X-Signature` (HMAC-SHA256 over the **raw** body) before applying status. Raw-body capture added to `express.json`.
- **Sandbox stub** (active until an Sdk-Partner-Token + whitelisted IP land): simulates the redirect + status progression so the flow is demoable; live provider calls the real Mercuryo API when `MERCURYO_SDK_PARTNER_TOKEN` is set.
- Endpoints `POST/GET /v1/offramp/sessions[/:id]` + callback; contract types + OpenAPI; web Off-ramp page (withdraw form, live polling, fiat estimate); `.env.example` documents `MERCURYO_*` / `OFFRAMP_*`.

### Verified
- Callback signature gate: valid `X-Signature` → 200, invalid → 401 (raw-body HMAC). Sandbox create + status progression work end-to-end in the UI. `tsc` clean (all workspaces). Live Mercuryo REST calls implemented to spec but **untested pending sandbox partner token + IP whitelist**.

> ⚠️ **Open architecture question:** Mercuryo's sandbox lists BTC/ETH/USDT only — **Stellar assets may not be supported** for off-ramp. Confirm via `GET /b2b/currencies` before relying on it for Stellar-USDC settlement payouts. If unsupported, either bridge to a Mercuryo asset or use a Stellar-native anchor.

## [0.1.5.1] — 2026-08-03

### Docs
- Updated `docs/API_ARCHITECTURE.md` for the auth pivot: **httpOnly cookie sessions** (no Bearer/refresh token), **Google sign-in (custodial)** + **SEP-10 wallet connect (non-custodial)** replacing the old Privy/`/v1/onboard` model. Refreshed the endpoint catalog (auth + `/v1/tx/*` + `/v1/settlement/*` now marked live), core data shapes (session + settlement types), custody boundary for delegated signing, environments (pnpm, Next.js `NEXT_PUBLIC_API_URL`, cookie/CORS), and non-negotiables.

## [0.1.5.0] — 2026-08-03

### Added (PAT-13 · D6 — Settlement Explorer re-integrated into the Next.js app)
- Ported the Settlement Explorer to the current Next.js/React 19/Tailwind web app (`web/app/settlement/page.tsx`) after the web rewrite dropped the earlier Vite version. Batch list + Source → Split → Driver drill-down (per-driver SCOUT tier / multiplier / payout), reading the live settlement API.
- Reviewer "run sample settlement" action now generates + Friendbot-funds 3 driver accounts client-side (the old `/v1/onboard` was removed in the auth pivot) and executes a 100 XLM 50/30/20 split.
- Settlement methods added to `web/app/lib/api.ts` (contract-typed); top nav link in `web/app/layout.tsx`.

### Verified
- End-to-end in the Next.js app on testnet: 100 XLM → 50/30/20; 3 distinct drivers 1.0/1.2/1.5 → 8.1081082 + 9.7297297 + 12.1621621 = 30.0000000; single multi-op tx on Horizon. `tsc` clean.

## [0.1.4.0] — 2026-07-31

### Added (PAT-13 · Phase 4 · D6 — Settlement engine + SCOUT multipliers)
- Deterministic **50 / 30 / 20** settlement engine (`stellar/settlement.ts`): 50% Authorities, 30% Driver Rewards, 20% Treasury, computed in integer stroops so parts sum to gross exactly. Driver pool split by SCOUT reputation multiplier (tier 1/2/3 → 1.0× / 1.2× / 1.5×). Executes as one multi-operation Stellar tx.
- `POST /v1/settlement/batches` (execute), `GET /v1/settlement/batches` (list, cursor-paged), `GET /v1/settlement/batches/{id}` (drill-down) — plus a settlement **indexer v1** (in-memory; feeds D8).
- Settlement funded from a dev-tier source account (testnet), keeping the real treasury multisig untouched/human-gated.
- Web **Settlement Explorer**: batch list + Source → Split → Driver drill-down with per-driver tier/multiplier/payout, and a reviewer-facing "run sample settlement" action.
- Contract: settlement types + OpenAPI paths/schemas; added `packages/contract/tsconfig.json` so the contract workspace typechecks in CI.

### Fixed
- Dev-tier `userId` derivation now hashes the Privy token (sha256) instead of truncating its hex, so distinct tokens no longer collide onto the same managed wallet.

### Verified
- End-to-end on testnet (backend and via the ops-console UI): 100 XLM → 50/30/20 split; 3 distinct drivers weighted 1.0/1.2/1.5, payouts summing to exactly 30; single 5-op tx `successful` and publicly verifiable on Horizon.

## [0.1.3.0] — 2026-07-31

### Added (PAT-5 · Phase 1 · D1 — Delegated signing endpoints)
- `POST /v1/tx/build` — builds a transaction from the caller's managed wallet and **delegate-signs** it (payment / createAccount / changeTrust operations, optional memo); returns signed XDR + hash.
- `POST /v1/tx/submit` — submits a signed envelope (managed or external-wallet) to Horizon; returns hash, `successful`, ledger, and explorer URL.
- Dev-tier **managed wallet provider** (`stellar/managed.ts`) simulating Privy embedded wallets: per-user testnet keypair, Friendbot-funded on first onboard, backend-signable via the `Signer` interface (in-memory secrets, testnet-only; mainnet uses Privy/KMS).
- `POST /v1/onboard` now returns a **real provisioned + funded** managed wallet address.
- Request validation via zod; `ZodError` mapped to `400 ValidationError`; `AccountNotFound` (404) and `HorizonRejected` (422) surfaced cleanly.

### Verified
- End-to-end on testnet: onboard → build (delegate-signed) → submit → tx `successful`, publicly verifiable on Horizon (1 backend signature).

## [0.1.2.0] — 2026-07-31

### Added (PAT-9 · Phase 2 · D2 — Wallet interoperability)
- Wallet Interop surface in the ops console: connect an external Stellar wallet via Stellar Wallets Kit (Freighter, Lobstr, xBull, Albedo…), load the account from Horizon, fund via Friendbot, and sign & submit a testnet transaction. Reviewer-facing.
- `web/src/wallet/kit.ts`: Wallets Kit integration module (connect/disconnect, session persistence, Horizon account load, Friendbot, external-wallet sign + submit).
- Ported the preserved vanilla-TS D2 prototype (`legacy/wallet-demo.ts`) into a React page with the shared UI kit.

### Changed
- Wallet Interop route lazy-loaded (`React.lazy` + `Suspense`) so the Stellar SDK stays out of the main bundle — main chunk back to ~58 kB gzip; SDK loads on demand.
- Sidebar marks Wallet Interop as ready (drops the phase tag).

## [0.1.1.0] — 2026-07-25

### Added (PAT-7 · Phase 1 · D1 — Web ops console)
- React ops console (`web/`) on the Vite/TS baseline: sidebar shell, top bar, routing.
- Shared UI kit: design tokens (`ui/theme.css`), primitives (Button, Card, Field, Badge, StatCard, EmptyState), table and layout styles.
- Auth gate: `AuthProvider` + `RequireAuth` + login screen (Phase 1 dev-passcode scaffold; backend session auth swaps in during Phase 2 with no consumer changes).
- Live Dashboard reading Backend Core `/health` and `/v1/accounts/distribution`; distribution-account table with Horizon links and the treasury multisig human-gate badge.
- Typed backend API client (`api/client.ts`) built on `@pathpulse/contract`.
- Phase-tagged placeholder surfaces (Wallet Interop, Payouts, Off-ramp, Settlement Explorer, Gov Gateway) so the shell structure is complete from Phase 1.

### Changed
- Web workspace renamed `@pathpulse/web`; adopted React 18 + react-router-dom.
- Preserved the D2 wallet demo under `web/src/legacy/` for the PAT-9 port.

## [0.1.0.0] — 2026-07-25

### Added (PAT-5 · Phase 1 · D1 — Backend foundation)
- Monorepo scaffold (`backend/`, `web/`, `android/`, `ios/`, `packages/contract/`), CI, shared OpenAPI contract.
- Backend Core: managed distribution accounts, delegated-signing API, KMS-abstracted dev signer (refuses mainnet), Privy onboarding scaffold.
- Three distribution accounts provisioned + Friendbot-funded on Stellar testnet; treasury multisig transaction built and left at the human gate.
