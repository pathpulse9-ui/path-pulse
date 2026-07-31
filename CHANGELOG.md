# Changelog

All notable changes to PathPulse are documented here.

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
