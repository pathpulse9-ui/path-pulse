# PathPulse — System Architecture

> One shared backend. Three thin clients. The settlement system is **server-side**;
> the apps only render it.

## Why server-side

Treasury multisig signing, SDP payout orchestration, Stellar Broker
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
   │ no wallet│    │ no wallet│           │Freighter/Lobstr │
   └──────────┘    └──────────┘           └─────────────┘   └───────────────┘
```

## The only client-side crypto

- **Stellar Wallets Kit** (web only) — Freighter is a browser extension, so external-wallet
  interop (Freighter/Lobstr/xBull/Albedo) can only exist on the web surface. This is the
  one path where the key is genuinely the user's: it stays in the extension, the user
  signs, and the backend never sees a secret. SEP-10 proves account ownership and
  establishes an httpOnly cookie session.

There is no client-side crypto on Android or iOS. Both apps are thin API consumers.

**Privy is not integrated and is not planned.** It was the original design for
email/OAuth → embedded wallet on all three surfaces; it was substituted, not deferred.
See `docs/CUSTODY.md` for what replaced it and what that costs in custody terms.

**Clients never sign settlement transactions.** Settlement, group payout, SCOUT issuance
and AMM routing are all signed backend-side from service accounts.

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

- `needs-human-gate`: treasury key material, mainnet deployment. Agent writes config +
  dry-runs on testnet, then stops.
- `external-dependency`: SDP tenancy, Mercuryo KYC. Build against sandbox; onboarding is
  requested in Week 1 and resolved outside the codebase.
