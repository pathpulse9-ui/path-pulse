# PathPulse — System Architecture

> One shared backend. Three thin clients. The settlement system is **server-side**;
> the apps only render it.

## Why server-side

Treasury multisig signing (HSM/KMS-backed), SDP payout orchestration, Stellar Broker
liquidity routing, the deterministic 50/30/20 settlement engine and SCOUT asset issuance
all require **trusted authority and private keys**. Those can never live in an Android APK
or iOS binary. So they run in one shared backend service. Both mobile apps stay thin and
behaviorally identical because they consume the same API.

```
                    ┌──────────────────────────────────────┐
                    │         BACKEND CORE  (Node/TS)        │
                    │  @stellar/stellar-sdk · Postgres · Redis│
                    │  managed accounts · multisig treasury   │
                    │  delegated signing · SDP · Mercuryo     │
                    │  Broker routing · 50/30/20 engine       │
                    │  SCOUT issuance · indexer               │
                    │        REST + WebSocket API             │
                    └───────────────┬────────────────────────┘
                                    │  one API contract (OpenAPI)
        ┌───────────────┬───────────┴───────────┬─────────────────┐
   ┌────┴─────┐    ┌────┴─────┐           ┌──────┴──────┐   ┌───────┴───────┐
   │ Android  │    │   iOS    │           │     Web     │   │  Gov / Ops    │
   │ Kotlin   │    │  Swift   │           │  React/TS   │   │  dashboard    │
   │ Compose  │    │ SwiftUI  │           │ Wallets Kit │   │  (web surface)│
   │ Privy SDK│    │ Privy SDK│           │Freighter/Lobstr │
   └──────────┘    └──────────┘           └─────────────┘   └───────────────┘
```

## The only client-side crypto

- **Privy embedded wallets** — the *driver's own* Stellar wallet, provisioned on-device via
  the Privy SDK (Android/iOS/web) from an email/OAuth sign-up. This is the driver's key.
- **Stellar Wallets Kit** (web only) — Freighter is a browser extension, so external-wallet
  interop (Freighter/Lobstr) can only exist on the web surface.

**Treasury keys never leave the backend.** Clients never sign settlement transactions.

## Repositories (monorepo)

```
path-pulse/
├── backend/            Node/TS — the spine (owns all Stellar logic)
├── web/                React/Vite — Wallets Kit demo + ops console + gov dashboard (D8)
├── android/            Kotlin / Jetpack Compose (Daiwik)
├── ios/                Swift / SwiftUI (Daiwik)
├── packages/contract/  OpenAPI spec — single source of truth for the API
├── docs/               architecture, phase plan, runbooks, handover
└── scripts/            testnet helpers, account provisioning dry-runs
```

`packages/contract` is the glue: the API is defined once as OpenAPI and typed clients are
generated for TS, Kotlin and Swift so the three surfaces cannot drift apart.

## Network policy

- **Phases 1–4 → Stellar testnet only.** No mainnet artifact is created before Phase 5.
- **Phase 5–6 → mainnet, behind human gates.** No mainnet transaction is constructed or
  signed without explicit human sign-off (treasury key ceremony).

## Human-gated & external boundaries (see docs/PHASE_PLAN.md)

- `needs-human-gate`: treasury/HSM key material, mainnet deployment. Agent writes config +
  dry-runs on testnet, then stops.
- `external-dependency`: SDP tenancy, Mercuryo KYC. Build against sandbox; onboarding is
  requested in Week 1 and resolved outside the codebase.
