# Changelog

All notable changes to PathPulse are documented here.

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
