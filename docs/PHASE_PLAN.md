# PathPulse — 75-Day Phase Plan & Ownership

**Duration:** Jul 21 2026 → Oct 3 2026 · 75 days · 6 phases · Deliverables D1–D8
**Team:** 2 engineers (plan was scoped for 4–5 — scope is trimmed and serialized accordingly)
**Tracking:** Linear team `CUB`, issues CUB-5 (D1) → CUB-12 (D8). Protocol in `../PathPulse/CLAUDE.md`.

## Ownership

| Dev | Owns | Languages |
|-----|------|-----------|
| **Aaditya** | Backend Core + Web Platform | TypeScript |
| **Daiwik** | Android + iOS (Android-first, then port to Swift) | Kotlin, Swift |

The **backend is the critical path** — every client feature waits on its API. Backend leads
each phase by a few days; the API contract (`packages/contract`) is updated first, then clients
build against it. Web sits with Aaditya because the ops console / gov dashboard read the backend
indexer directly (both TS, tightly coupled).

## Phase timeline

| Phase | Days | Dates 2026 | Focus | Deliverables |
|-------|------|-----------|-------|--------------|
| **1. Foundation & Managed Accounts** | 1–12 | Jul 21 – Aug 1 | Account layer, Privy onboarding, multisig treasury, scaffolds + CI | D1 |
| **2. Wallet Interop & Payout Rails** | 13–25 | Aug 2 – Aug 14 | Wallets Kit demo, SDP batch payouts, reward screens | D2, D3 |
| **3. Off-Ramp & Liquidity Routing** | 26–40 | Aug 15 – Aug 29 | Mercuryo SEP-24, Stellar Broker + Aquarius routing | D4, D5 |
| **4. Settlement Engine & SCOUT** | 41–55 | Aug 30 – Sep 13 | 50/30/20 engine, SCOUT reputation assets, indexer | D6 |
| **5. Mainnet Readiness** | 56–65 | Sep 14 – Sep 23 | Security review, HSM prod signing, mainnet rollout, monitoring | D7 |
| **6. Gov Gateway, QA & Handover** | 66–75 | Sep 24 – Oct 3 | Gov audit dashboard, compliance exports, E2E QA, handover | D8 |

## Phase 1 — task board (Days 1–12, covers D1)

### Backend + Web (Aaditya)
- [ ] Monorepo, environments, CI/CD for all four codebases; testnet config
- [ ] Deploy protocol-governed distribution accounts: **Partner Revenue, Driver Pool, Treasury** (testnet)
- [ ] Multi-signature treasury config (threshold ≥ 2/3 signatories) on testnet  *(needs-human-gate: signer set approved manually)*
- [ ] Privy server-side integration: email/OAuth → managed Stellar wallet provisioning
- [ ] Delegated transaction construction & signing API; KMS-backed signing (dev tier)
- [ ] Web: monorepo baseline (extend `d2-wallet-interop`), shared UI kit, internal ops shell with auth

### Android + iOS (Daiwik)
- [ ] Jetpack Compose app scaffold, design system, networking layer
- [ ] Privy Android SDK onboarding: email/OAuth sign-up → embedded Stellar wallet
- [ ] Encrypted local storage + session management (Android)
- [ ] SwiftUI app scaffold mirroring Android IA
- [ ] Privy iOS SDK onboarding; Keychain-backed session storage

### Exit criteria (the gate — these are the definition of done)
- [ ] Multisig treasury accounts live on testnet with threshold config validated
- [ ] Email → Stellar wallet flow functional inside both mobile apps via Privy
- [ ] Delegated signing flow validated end-to-end; transactions verifiable on Horizon
- [ ] CI pipelines green on all four repos

> **Human gate:** treasury key material and signer set are approved manually, never
> auto-provisioned. We generate/config on testnet and dry-run; a human validates before "Done".

## Week-1 external kickoffs (do regardless of code progress)
- [ ] Request **SDP tenant** onboarding (blocks Phase 2) — build against SDP sandbox meanwhile
- [ ] Initiate **Mercuryo** partnership + KYC/compliance (blocks Phase 3 go-live) — sandbox integration proceeds
- [ ] Define **PulseGen score-feed contract** (SCOUT tiers need it in Phase 4) — synthetic scores until live

## Scope-cut notes for a 2-person team
- Mobile is the schedule risk (one dev, two native apps). Build **Android fully first**, port
  each screen to iOS behind it. If a phase slips, iOS is the fast-follow, never the backend.
- Treat every phase's **exit criteria** as the gate, not the calendar date.
- Anything `needs-human-gate` / `external-dependency` is prepared to the boundary and stopped —
  never blocked on silently.
