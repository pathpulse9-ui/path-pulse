# Changelog

All notable changes to PathPulse are documented here.

## [0.1.10.0] — 2026-08-25

### Fixed (T1 review — delegated path was unreachable for end users)
- `ensureAccountForEmail` now provisions through `provisionManagedWallet()` instead of generating its own keypair. The Google email/OAuth flow and the delegated signer previously wrote to and read from **two disconnected in-memory stores**, so every Google user received a funded managed address whose transactions all returned 404. Nothing wrote an end user into the signer's store — `provisionManagedWallet()` was called only by the four internal service accounts.
- Stale 404 text on `/v1/tx/build` and `getManagedSigner` no longer directs callers to `POST /v1/onboard`, a route removed in the auth pivot.

### Security
- **`POST /v1/tx/build` now requires a session** and derives the signing identity from it; a `userId` in the request body is ignored. It previously took `userId` straight from the body with no session check, so any unauthenticated caller who knew a user id — a value returned to the client by `/v1/auth/google/verify` — could have the backend delegate-sign an arbitrary payment out of that user's managed wallet. Reachable in practice only after the store-wiring fix above, since before it no end-user account existed in the signer's store. `/v1/tx/submit` is deliberately left ungated: it relays an already-signed envelope, which anyone can submit to Horizon directly.
- Contract: `BuildTransactionRequest` no longer requires `userId` on the wire.

### Added
- `docs/CUSTODY.md` — the authoritative statement of custody model, signer-backend status, delegated-path auth, known limitations, and both treasury accounts.
- `backend/scripts/provision-treasury-v2.ts` — provisions a treasury with master weight 0 and a real 2-of-3, **persisting signer secrets to `secrets/treasury-v2.json`** (gitignored, mode 0600) rather than printing them to stdout.
- Replacement treasury `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` — master weight 0, three weight-1 signers, thresholds 2/2/2. Config tx `9f93fc82…0856`; two-signer proof `4face5e7…3722` (exactly 2 signatures).

### Changed (documentation accuracy — Privy substitution)
- **Privy is formally substituted, not deferred.** It is not integrated in any branch: no SDK, no API call, no credential. `docs/ARCHITECTURE.md`, `docs/PHASE_PLAN.md`, `docs/AWS_COST_AND_KEY_STORAGE.md`, `docs/API_ARCHITECTURE.md`, `ios/README.md` and `README.md` no longer present it as the mainnet plan; it survives only as one unselected option in the vendor cost comparison.
- Docs no longer imply KMS/HSM-backed signing is in service. The `aws-kms` / `gcp-kms` / `hsm` branches are declared and throw; the live signer is `dev` (`DevSigner`, in-memory) in every environment.
- `README.md` multisig claim corrected: the ≥ 2-of-3 description applies to the replacement treasury. The original `GADPEI5O…` shipped as **2-of-4** with the master key retained at weight 1 and its three signer secrets unrecoverable — it is permanently frozen and cannot authorize even a `set_options` to repair itself.

### Known limitations (unchanged, now documented)
- Managed keys remain in process memory with no persistence: any redeploy orphans every managed account created before it, permanently. App Runner stays pinned to one instance for this reason.
- `secrets/treasury-v2.json` is not in a managed secret store. It is a single point of failure.
- The demo's distribution env vars still point at the original, frozen treasury; migration is outstanding.

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
