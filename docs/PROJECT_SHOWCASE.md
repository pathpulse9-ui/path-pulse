# PathPulse — Project Showcase

> Compiled 2026-09-27 · Day **69 of 75** of the contracted plan (Jul 21 → Oct 3, 2026)
> Cross-referenced against `docs/PathPulse_75Day_Development_Plan.pdf` (PathPulse.ai × EngxLab)
> Code metrics measured from this repository at commit `c8b458d`.

---

## 1. What This Project Is

**Blockchain settlement infrastructure on the Stellar network that makes the arithmetic of a reward programme auditable — a deterministic 50/30/20 revenue split executed as one atomic multi-operation transaction, not reported as a spreadsheet.**

Institutional reward programmes share a failure mode: money goes in one end, recipients are told what came out the other, and the calculation in between is a spreadsheet nobody outside the operator can inspect. Disputes are unanswerable because there is nothing to check.

PathPulse makes the ledger the arithmetic. A settlement batch computes its split deterministically, applies each contributor's on-chain reputation multiplier, and lands as a single Stellar transaction. The split is not reported — it is executed. Anyone holding the transaction hash can reconstruct the whole distribution, from treasury deposit down to an individual payout, without access to any PathPulse system.

The system spans four delivery surfaces — a shared backend service, a web platform, and native Android and iOS apps — against a contracted roadmap of eight deliverables (D1–D8) across three tranches.

---

## 2. Key Features & Functionality

### Settlement engine
- **Deterministic 50/30/20 split** — 50% authorities, 30% driver rewards, 20% treasury, enforced in a single multi-operation Stellar transaction. Arithmetic runs in integer stroops, so the parts sum to the gross by construction rather than by rounding luck.
- **Reputation-weighted driver share** — the 30% pool is divided by on-chain SCOUT multipliers (1.0× / 1.2× / 1.5×), proven to hold the exact ratio 1 : 1.2 : 1.5.
- **Settlement indexer** — every batch is recorded with its source transaction hash and per-driver payouts, and becomes the data source for the government dashboard.
- **Crash-safe ordering** — the batch is persisted the moment the on-chain split confirms, before the payout fan-out is attempted, so a provider outage can never leave funds moved with no indexer record.

### SCOUT on-chain reputation
- **Classic Stellar assets** `SCOUT1/2/3` issued with `AUTH_REQUIRED`, `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED`, visible in any Stellar-compatible wallet.
- **The chain is the source of truth** — a settlement request carries no tier. The engine reads the badge the driver actually holds, so an operator cannot assert a multiplier through the API.
- **Revocation in one issuer-signed transaction** — `clawback` plus `setTrustLineFlags{authorized: false}`. No holder signature is required, and a holder cannot reacquire the badge by keeping the trustline open.
- **Score provenance** — every payout records the score behind its multiplier *at settlement time*, so a later rescore cannot rewrite why a past batch paid what it paid.

### Payout rails & fiat off-ramp
- **SDP batch disbursements** — the driver share hands off to a self-hosted Stellar Disbursement Platform tenant for orchestrated bulk payout with per-recipient receipts and per-call reconciliation records.
- **USDC → INR off-ramp** through Carret Infra, an FIU-IND registered VASP, behind an `OffRampProvider` interface.
- **Mandatory settlement linkage** — an off-ramp session cannot exist without a `settlementBatchId`; an unknown id returns 404 and the UI disables submission.
- **Orphan reconciler** — recovers both a missed webhook and an interrupted session whose order id was never learned, matching on amount and timestamp, and refusing to credit one provider order to two withdrawals.

### Liquidity routing
- **Multi-source aggregator** — Aquarius and Stellar Broker are quoted in parallel and the better price wins. Aquarius is the execution venue; Broker is quote-only (`canExecute: false`).
- **Soroban path execution** — conversions run through the Aquarius router contract via `swap_chained`, signed by a key held in AWS KMS.
- **Treasury routing plan** — live balances, per-asset quotes into USDC, and a projected post-conversion settlement total. Execution is human-gated.

### Custody & key management
- **AWS KMS as root of trust** — protocol accounts sign with an Ed25519 key (`ECC_NIST_EDWARDS25519`, `ED25519_SHA_512` over `MessageType: RAW`) generated in and never leaving AWS-managed HSM hardware.
- **Additive signer model** — the KMS-derived address is added *alongside* each account's existing signer, never as the sole one, so losing the KMS key degrades signing rather than stranding an account.
- **Driver seeds sealed at rest** — AES-256-GCM with a fresh IV per seal, under a key-encryption key that is itself wrapped by KMS and unwrapped at startup. Plaintext exists only inside the signing module, only long enough to build a keypair.
- **Human-gated treasury** — a 2-of-3 multisig with the master key weight explicitly set to 0. The backend never signs a treasury reconfiguration; it returns unsigned XDR for a quorum to sign out of band.

### Governance & audit
- **Government Settlement Gateway** — end-to-end traceability from treasury deposit → settlement split → SDP → individual driver payout, behind a partner passcode gate.
- **Compliance exports** — settlement history as CSV or PDF over a date range, for regulators who need a document rather than an endpoint.
- **Operator role separation** — anything that moves protocol funds requires an `ops` session; anonymous callers get 401 and any valid non-ops session gets 403.

### Client surfaces
- **Web console** — settlement, payouts, treasury, SCOUT, off-ramp, KYC and profile tabs, plus the separate government gateway.
- **Native Android and iOS apps** with matching information architecture — sign-in, dashboard, settlement, SCOUT badges, treasury, off-ramp and KYC.

---

## 3. Who It Serves / How It Helps

- **Contributors and drivers** — receive stablecoin rewards weighted by a reputation tier they can see in their own wallet, and convert to local currency through a regulated partner without leaving the app.
- **Programme operators** — run settlement batches, fan out payouts and manage treasury from one console, with every fund-moving action behind an operator role.
- **Governments and institutional partners** — audit a distribution end to end without trusting PathPulse's own reporting: the transaction hash is sufficient, and compliance exports produce the document a regulator asks for.
- **Reviewers and auditors** — every claim in the evidence pack maps to a public Horizon record, a running service, or code in this repository.

The net effect: a reward programme's split stops being a disclosure and becomes a verifiable fact.

---

## 4. System Architecture (High Level)

One shared backend service owns the settlement system; the mobile apps and web console stay thin and behaviourally identical because they consume the same API.

```mermaid
flowchart LR
    subgraph Clients["Client Surfaces"]
        WEB[Web Console<br/>Next.js]
        AND[Android<br/>Compose]
        IOS[iOS<br/>SwiftUI]
        GOV[Gov Gateway<br/>partner-gated]
    end

    subgraph Core["Backend Core — Node / TypeScript"]
        API[REST API<br/>session + role guards]
        ENG[Settlement Engine<br/>50/30/20]
        SCT[SCOUT Issuance<br/>& Revocation]
        RTE[Routing Aggregator]
        OFF[Off-Ramp Orchestrator<br/>+ reconciler]
        IDX[Settlement Indexer<br/>& Exports]
    end

    subgraph Keys["Key Management"]
        KMS[AWS KMS<br/>signer + KEK]
        MSIG[Treasury 2-of-3<br/>human-gated]
    end

    subgraph Chain["Stellar Network — testnet"]
        HOR[(Horizon)]
        AQUA[Aquarius Router<br/>Soroban]
        SCOUT[(SCOUT Assets)]
    end

    subgraph Ext["External Services"]
        SDP[Stellar Disbursement<br/>Platform]
        CAR[Carret Infra<br/>USDC → INR]
        BRK[Stellar Broker<br/>quote-only]
        PG[PulseGen<br/>score feed]
    end

    DB[(PostgreSQL)]

    WEB & AND & IOS & GOV --> API
    API --> ENG & SCT & RTE & OFF & IDX
    ENG --> HOR
    ENG --> SDP
    SCT --> SCOUT
    RTE --> AQUA
    RTE -.quotes only.-> BRK
    OFF <--> CAR
    SCT <-- scores --- PG
    ENG & SCT & RTE --> KMS
    MSIG -.unsigned XDR.-> API
    ENG & OFF & IDX --> DB
```

**Request path for a settlement:** operator submits a batch → engine resolves each driver's multiplier from the on-chain badge → builds one transaction with three payment operations → signs through KMS → submits to Horizon → persists the batch with its tx hash → hands the driver share to SDP for per-driver fan-out → the indexer serves it to the console and the government dashboard.

---

## 5. Technology Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 20+, TypeScript (strict), Express 4, `@stellar/stellar-sdk` 13, pino structured logging, Zod validation |
| Web | Next.js 16, React 19, Tailwind CSS 4, `@creit.tech/stellar-wallets-kit`, PapaParse, `read-excel-file` |
| Android | Kotlin, Jetpack Compose |
| iOS | Swift, SwiftUI |
| Database | PostgreSQL (schema applied at boot; Neon in the deployed environment) |
| Key management | AWS KMS — `ECC_NIST_EDWARDS25519` signing key + a KEK-wrapping key; AES-256-GCM seed sealing |
| Blockchain | Stellar testnet, Horizon, Soroban (Aquarius router contract), SEP-10 web authentication |
| Auth | Google Identity Services (ID-token verification), SEP-10 wallet challenge, httpOnly signed session cookies |
| Security | helmet, express-rate-limit, constant-time passcode comparison, raw-body webhook signature verification |
| Documents | PDFKit receipts, CSV compliance exports |
| Monorepo | pnpm 11 workspaces, shared `@pathpulse/contract` type package |
| Deployment | Docker, AWS App Runner, Makefile-driven deploys |

---

## 6. Verification Guarantees

What makes the settlement auditable rather than merely reported:

- **Atomicity** — the three-way split is one transaction. A partial distribution is not a state the system can reach; if any operation fails the whole settlement fails.
- **Chain-resolved multipliers** — the engine ignores any tier supplied in the request and reads the badge on chain. Submitting all three drivers as `tier: 1` still pays 1.0× / 1.2× / 1.5× correctly, which is the property the evidence pack demonstrates.
- **Integer arithmetic** — splits compute in stroops, so parts sum to the gross exactly; the published figures show `1.5000000 / 0.9000000 / 0.6000000` against a 3 USDC gross.
- **Independent verifiability** — every settlement is a public Horizon record. A reviewer inspects the three payment operations directly and confirms destinations and amounts without PathPulse involvement.
- **Provenance without laundering** — imported scores record supplier, arrival time, importing operator and a SHA-256 of the exact payload. The provenance attests to *receipt, not correctness*; nothing in the import path makes a number authoritative.
- **No operator-chosen tiers** — the assignment API takes a driver id and reads the score from the feed. Even the interim synthetic feed is deterministic per driver id (SHA-256 derived), so a tier is reproducible by anyone holding the id and cannot be hand-picked.
- **Signature isolation** — protocol signatures are produced inside KMS hardware; no private key material exists in the application process.

---

## 7. Integrations

| Service | What it enables | State |
| --- | --- | --- |
| Stellar Horizon (testnet) | Transaction submission, account and ledger reads | Live |
| Stellar Disbursement Platform | Per-driver payout fan-out, tenant `bluecorp` | Live, self-hosted |
| AWS KMS | Protocol signing + key-encryption-key wrapping | Live |
| Aquarius AMM (Soroban) | Cross-asset conversion — the execution venue | Live |
| Stellar Broker | Parallel price quoting | Quote-only — cannot fill on testnet |
| Carret Infra | USDC on Stellar → INR via `bank_transfer`, KYC/AML | Live in Carret's dev environment |
| Google Identity Services | Custodial sign-in via verified ID token | Live |
| Stellar Wallets Kit | External wallet connect — Freighter, Lobstr, xBull, Albedo, Rabet, WalletConnect | Live |
| PostgreSQL | Settlements, sessions, wallets, off-ramp sessions, score imports | Live |
| PulseGen | Contributor validation scores driving SCOUT tiers | **Not connected** — awaiting credentials |

---

## 8. Deliverable Completion Status

Cross-referenced against the 75-day plan's phase structure and its measures of completion.

### Tranche 1 — MVP (D1–D3)

| Deliverable | Scope | Status |
| --- | --- | --- |
| **D1** — Foundation & managed accounts | Distribution accounts, multisig treasury, managed wallet provisioning, delegated signing, CI | **Formally approved 2026-08-27** |
| **D2** — Wallet interoperability | Stellar Wallets Kit, SEP-10 challenge/verify, `stellar.toml`, reviewer demo | **Complete** — external keypair authenticated via SEP-10 and signed testnet tx `b3617740…` |
| **D3** — Institutional payout infrastructure | Self-hosted SDP, tenant provisioning, batch payouts, reconciliation | **Complete** — tenant `bluecorp`, completed disbursements with per-recipient payment hashes |

### Tranche 2 — Testnet (D4–D6)

Compiled as `docs/TRANCHE2_PROOF_OF_COMPLETION.md` (2026-09-16), reviewed, and answered in `docs/TRANCHE2_REVIEW_RESPONSE.md` (2026-09-19).

| Deliverable | Criteria | Status |
| --- | --- | --- |
| **D4** — Fiat off-ramp | 4 | 4 / 4 claimed · **1 correction issued**, 1 item deferred to mainnet |
| **D5** — Cross-asset routing | 4 | 4 / 4 claimed · **scope modification filed** |
| **D6** — Settlement engine & reputation assets | 7 | 7 / 7 claimed · **criterion 6.3 superseded and re-proven** |
| **Total** | **15** | **15 / 15 claimed, with two modifications awaiting client approval** |


- **D4.1** — Carret orders 1279 / 1280 / 1281 were funded by a Carret-side dev credit, **not by a Stellar transfer on any network**. No USDC moved and no transfer hash exists. Those orders prove the Carret API path and INR bank settlement, nothing about an on-chain deposit. An on-chain off-ramp deposit linked to a settlement batch is achievable only on mainnet and is carried as a Phase 5 criterion rather than claimed here.
- **D5** — the phrase "each acting as the other's fallback" was withdrawn. Fallback is one-directional: a failed Broker quote costs a price comparison; a failed Aquarius costs the fill.
- **D6.3** — the assignment API previously accepted a score and minted a brand-new random driver, meeting neither half of the criterion. It now takes a driver id, reads the score from the feed, and grants the badge to the driver's existing managed wallet. Re-proven end to end on three existing drivers.

### Tranche 3 — Mainnet & Handover (D7–D8)

| Deliverable | Status |
| --- | --- |
| **D7** — Mainnet readiness | **Partially complete.** Security review done and findings fixed; AWS KMS production signing in service; operator role and mainnet preflight guards shipped. **Mainnet cutover itself is not done** — `docs/MAINNET_CUTOVER.md` is an open checklist, and the network gate (`assertMainnetAllowed()`) refuses mainnet operation without a second explicit flag. |
| **D8** — Government gateway & handover | **Substantially built.** Gov dashboard, settlement drill-down, audit views, partner access control, and CSV/PDF compliance exports are live; E2E and load-test scripts exist. Production handover is outstanding. |

### Deviations from the plan as written

| Plan (PDF) | Delivered | Why |
| --- | --- | --- |
| Mercuryo SEP-24 off-ramp | Carret Infra (FIU-IND VASP) | No INR corridor, XLM-only Stellar support, not a SEP-24 anchor |
| Stellar Broker executes conversions | Aquarius executes; Broker quotes | Broker cannot fill on testnet — no partner key, mainnet-priced quotes |
| Privy SDK embedded wallets | Google Identity Services + Stellar Wallets Kit | Substituted; no on-device crypto or embedded wallet (`ios/README.md`) |
| Vite / React web platform | Next.js 16 | Framework change |
| PostgreSQL **and Redis** | PostgreSQL only | Redis never introduced; noted in `middleware/rateLimit.ts` as the fix for multi-instance rate limiting |
| HSM production signing | AWS KMS | KMS keys are generated in and never leave AWS-managed HSM hardware, so a separate CloudHSM/PKCS#11 backend is unnecessary |

---

## 9. Notable Technical Strengths

- **Evidence discipline over claims.** Every figure in the tranche packs maps to a re-verified Horizon transaction. Where evidence did not support a claim, the claim was withdrawn in writing — the D4 funding correction and the D5 fallback wording were self-reported, not extracted by the reviewer.
- **Failure modes designed against, then proven.** The reconciler recovers a missed webhook and an interrupted session, and refuses to credit one provider order to two withdrawals. A real bug surfaced by that work — Carret returning `created_at` as a float epoch in seconds, which read as milliseconds lands in January 1970 — is normalised with a regression test.
- **Custody lessons applied structurally.** Losing the Tranche 1 account seeds (a provisioning script printed them to stdout and never persisted them) left three accounts permanently unable to hold USDC. The replacement scripts persist secrets before the first network call, and the KMS signer is always additive so no single key loss can strand an account.
- **Authority that cannot be asserted.** Tier, score and operator authority are all resolved from sources the caller does not control — the chain, the feed, and a role-gated session — rather than from request parameters.
- **Guards that fail at boot, not at the first signature.** A mainnet-configured deploy refuses to start on a dev signer, a missing `KMS_KEY_ID`, an absent `DATABASE_URL`, unset distribution accounts, or a testnet override left on — reporting every problem at once.
- **Four surfaces, one contract.** A shared `@pathpulse/contract` package keeps the web console, both native apps and the backend in type-level agreement.

---

## 10. Project by the Numbers

Measured from this repository on 2026-09-27 at commit `c8b458d`.

| Metric | Count |
| --- | --- |
| Contracted deliverables (D1–D8) | 8 across 3 tranches |
| Delivery surfaces | 4 — backend, web, Android, iOS |
| Distinct API route paths | 56 (62 handlers) |
| Database tables | 15 |
| Web pages | 14 |
| Android screens (Compose) | 9 |
| iOS views (SwiftUI) | 10 |
| Backend service modules | 18 |
| Stellar modules | 12 |
| Backend operational scripts | 15 |
| Backend test files | 11 |
| Protocol accounts on testnet | 7 |
| Tranche 2 measures of completion | 15 |
| Deliverable modifications filed | 2 |
| Documentation files (`docs/`) | 16 |
| Source files across all four surfaces | ~151 (59 backend TS · 40 web TS/TSX · 29 Kotlin · 23 Swift) |

> The documentation records a **114-passing backend test suite** as of 2026-09-19. That figure is quoted from `docs/TRANCHE2_REVIEW_RESPONSE.md` and was **not re-run** while compiling this showcase — the reconciler tests require a live Postgres instance.

---

## 11. Project Maturity / What's Next

### Open items, stated plainly

- **Treasury signer distribution is not done.** The on-chain 2-of-3 is real, but all three signer secrets currently sit in one file on one machine (`secrets/treasury-v2.json`, mode 0600, gitignored). Operationally that is a 1-of-1 until distributed to separate signatories. This is a mainnet-cutover prerequisite and is not claimed as complete.
- **PulseGen score feed is not connected.** Three sources are implemented — live REST, delivered batch, and a deterministic synthetic interim — but the live feed activates only when `PULSEGEN_BASE_URL` and `PULSEGEN_API_KEY` are supplied. The scores themselves are PathPulse.ai's system and the one input that cannot be supplied from this side.
- **On-chain off-ramp deposit remains a mainnet criterion.** Carret has no testnet; its dev environment transacts real mainnet USDC while PathPulse runs testnet, and the backend deliberately refuses to place a Carret order on testnet without an explicit override.
- **Operator actions are not yet attributable to a person.** `POST /v1/auth/ops/login` mints a throwaway `ops_<uuid>` and discards the caller's real identity, so a shared passcode makes two operators indistinguishable in the audit trail. Splitting authentication from authorisation is tracked in `docs/MAINNET_CUTOVER.md`.
- **Carret KYC ownership binding is open.** Anonymous access is closed, but resolving the account from the caller's own mapping is still outstanding.
- **Rate-limit counters are in-memory**, so limits are only correct while the service runs a single instance.
- **Three Tranche 1 accounts are permanently frozen** — seeds unrecoverable, and the old treasury was a 2-of-4 (master counted as a signer) rather than the documented 2-of-3. All three are replaced and the defect cannot be reproduced; `buildTreasuryMultisigTx` now sets `masterWeight: 0`.
- **`README.md` links `docs/PHASE_PLAN.md`, which does not exist** in the repository — a stale reference worth correcting or creating.

### Next levers

- **Complete the mainnet cutover** — key ceremony with three separate signatories, Carret and SDP production tenants, monitoring and alerting, then staged low-value pilot payouts behind the existing human gate.
- **Connect the live PulseGen feed** — the contract is written (`docs/SCORE_FEED_CONTRACT.md`) and the client is implemented and tested; it activates on credentials alone.
- **Enable Broker execution on mainnet**, where its quotes are correctly priced and a partner key can be issued, converting the aggregator from one execution venue to two.
- **Distribute the KMS treatment to the remaining distribution accounts** — the two are named as next in line.
- **Ship the mobile apps** — both apps carry the full driver-facing surface; store submission is a Phase 5 activity that absorbs review lead time.

---

*Sources: `docs/PathPulse_75Day_Development_Plan.pdf`, `docs/TRANCHE2_PROOF_OF_COMPLETION.md`, `docs/TRANCHE2_REVIEW_RESPONSE.md`, `docs/TESTNET_EVIDENCE.md`, `docs/MAINNET_CUTOVER.md`, `docs/production-launch.md`, `CHANGELOG.md`, and direct measurement of the repository at `c8b458d`.*
