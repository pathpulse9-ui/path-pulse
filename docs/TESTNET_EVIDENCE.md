# PathPulse — Tranche 2 (Testnet) evidence

Every claim on this page maps to a public artifact — a Stellar testnet transaction on Horizon, a running service, or code in this repo — so a reviewer can verify without running anything.

> **Scope:** Deliverables D2–D6 (contract Tranche 2, Testnet). Tranche 1 (D1) was formally approved 2026-08-27 and its evidence lives in [`README.md`](../README.md#deployed-on-testnet) and [`docs/KMS_VERIFICATION.md`](KMS_VERIFICATION.md).

**Demo:** <https://demo.pathpulse.ai> · **Network:** Stellar **testnet** for everything below.

---

## D2 — Wallet Interoperability (Stellar Wallets Kit)

**What's live**

The full Wallets Kit stack is integrated in the web app and reachable at [`demo.pathpulse.ai`](https://demo.pathpulse.ai). `@creit.tech/stellar-wallets-kit` fronts external wallet connections (Freighter, Lobstr, xBull, Albedo, Rabet, WalletConnect); the backend runs a stock SEP-10 challenge/verify at `GET /v1/auth/challenge` and `POST /v1/auth/wallet/verify` using `stellar-sdk`'s `WebAuth.verifyChallengeTxSigners`. The `stellar.toml` at [`demo.pathpulse.ai/.well-known/stellar.toml`](https://demo.pathpulse.ai/.well-known/stellar.toml) advertises the SEP-10 endpoint and SIGNING_KEY.

**Code paths**

| Concern | File |
|---|---|
| Wallets Kit init + connect | [`web/app/lib/stellar.ts`](../web/app/lib/stellar.ts) |
| Wallet connect UI + SEP-10 handshake + build/sign/submit demo | [`web/app/components/WalletConnect.tsx`](../web/app/components/WalletConnect.tsx) |
| Sign-in panel routing | [`web/app/components/auth/SignInPanel.tsx`](../web/app/components/auth/SignInPanel.tsx) |
| SEP-10 backend | [`backend/src/services/walletAuth.ts`](../backend/src/services/walletAuth.ts) |
| `stellar.toml` route | [`backend/src/routes/index.ts`](../backend/src/routes/index.ts) (line ~93) |

**Measures of completion**

| Measure | Evidence |
|---|---|
| External Stellar wallets connect via Stellar Wallets Kit | Live at [`demo.pathpulse.ai`](https://demo.pathpulse.ai) — Sign in → Connect wallet |
| Transaction signing validated through an external wallet | _pending_ — see PAT-51 |
| Testnet transactions executed via connected wallets | _pending_ — see PAT-51 |
| Functional demo accessible to reviewers | ✅ `demo.pathpulse.ai` open + `/dashboard/*` reachable |

<!-- FILL: PAT-51 - Freighter/Lobstr signed tx from demo.pathpulse.ai -->
> **Fill-in:** insert the tx hash + explorer link once PAT-51 captures it.

---

## D3 — Institutional Payout Infrastructure (Stellar Disbursement Platform)

**What's live**

We run our own SDP instance on Railway with a tenant provisioned for PathPulse.

| | |
|---|---|
| **Tenant** | `bluecorp` |
| **Tenant ID** | `6959c416-4712-40ad-bbc8-ad56553863aa` |
| **Distribution account** | [`GBERALDP7TQISOQFHZOSQOVEXXE5GRSM4NZC57OHPJGI5ATQ4OKISYPR`](https://stellar.expert/explorer/testnet/account/GBERALDP7TQISOQFHZOSQOVEXXE5GRSM4NZC57OHPJGI5ATQ4OKISYPR) |
| **Trustlines** | USDC, EURC |

**Code paths**

| Concern | File |
|---|---|
| SDP REST client (createDisbursement, list receivers, poll status) | [`backend/src/services/sdp.ts`](../backend/src/services/sdp.ts) |
| Payout batch orchestration + retry | [`backend/src/services/payouts.ts`](../backend/src/services/payouts.ts) |
| Per-recipient reconciliation attempts + persistence | [`backend/src/services/payoutAttempts.ts`](../backend/src/services/payoutAttempts.ts) + [tests](../backend/src/services/payoutAttempts.test.ts) |
| Group payout (CSV/XLSX upload) | [`backend/src/stellar/groupPayout.ts`](../backend/src/stellar/groupPayout.ts) |
| Ops UI | [`web/app/dashboard/payouts/page.tsx`](../web/app/dashboard/payouts/page.tsx) |
| Sample CSV | [`docs/samples/group-payout-usdc-sample.csv`](samples/group-payout-usdc-sample.csv) |

**Measures of completion**

| Measure | Evidence |
|---|---|
| Testnet payout batches executed through SDP | _pending_ — see PAT-52 |
| Stablecoin rewards distributed to contributor accounts | _pending_ — payment hashes to be captured in PAT-52 |
| Payout reconciliation logs verified | `GET /v1/ops/payouts/batches/:id/attempts` returns per-step attempt records (see `payoutAttempts.test.ts`) |
| End-to-end payout flow demonstrated | Backend → SDP → Horizon path in place; live batch run pending |

<!-- FILL: PAT-52 - disbursement id + payment hashes + reconciliation attempts JSON -->
> **Fill-in:** disbursement id and per-recipient payment hashes once PAT-52 captures them from the live batch.

---

## D4 — Fiat Off-Ramp (Carret Infra)

**What's live**

Carret Infra integration is fully proven end-to-end against `dev.carret.in`. Corridor: **USDC on Stellar → INR** to a registered bank via bank_transfer.

- Sub-account **`48559`** (`aditya.singh456m@gmail.com`) — KYC + AML verified
- Bank **`5831`** — Unity Bank test details, verified by Carret
- Wallet whitelist **`94`** — Stellar USDC address approved
- Provider abstraction: [`OffRampProvider`](../backend/src/services/offramp.ts) supports both `ramp` (Ramp Network, sandbox) and `carret` (default, live)

**Live off-ramp orders on Carret dev**

Each is a real order id on Carret; funds settled via a hand-approved crypto deposit (see `POST /crypto_deposit/`) so no on-chain Stellar send was required for the round-trip proof.

| Order id | Amount | Net INR | Status |
|---|---|---|---|
| `1279` | 10 USDC | ₹964.12 | filled |
| `1280` | 10 USDC | ₹963.83 | filled |
| `1281` | 10 USDC | ₹964.02 | filled |

Rate ≈ 97.9 INR / USDC, Carret fee 0.59%, TDS 1%.

**Code paths**

| Concern | File |
|---|---|
| Carret client (v1 off-ramp + banking + deposit addresses) | [`backend/src/services/carret.ts`](../backend/src/services/carret.ts) |
| Carret KYC (v2.0) client + web flow | on side branch [`upstream/carret-kyc`](https://github.com/pathpulse9-ui/path-pulse/tree/carret-kyc): `web/app/dashboard/kyc/page.tsx` + `backend/src/routes/index.ts` `/v1/carret/kyc/*` |
| Testnet-vs-mainnet safety guard (Carret is mainnet-only) | `carretLiveProvider.start` in `backend/src/services/offramp.ts` |
| Web off-ramp UI | [`web/app/dashboard/offramp/page.tsx`](../web/app/dashboard/offramp/page.tsx) |

**Measures of completion**

| Measure | Evidence |
|---|---|
| Off-ramp orchestration behind a provider interface | ✅ `services/offramp.ts` — `OffRampProvider` |
| Testnet withdrawal completes via provider sandbox | ✅ 3 orders filled on Carret dev, listed above |
| Off-ramp events linked to settlement batches | ✅ `settlementBatchId` optional on off-ramp session, validated 404 if unknown |
| Mobile SEP-24 hosted webview | ⏳ tracked separately (mobile critical path) |

---

## D5 — Liquidity Routing (Aquarius AMM)

**What's live**

- Router contract: `AQUA_ROUTER_CONTRACT=CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD` (Aquarius testnet)
- Aquarius API: `https://amm-api-testnet.aqua.network/api/external/v2` for path-finding + quotes
- Soroban RPC: `https://soroban-testnet.stellar.org`
- Slippage default: `100 bps` (1%)
- AMM routing source account (KMS-signed): [`GB2ATSCL5MS6TTT5TRUGXUP4AK2MRKUST5E6S6W7UO4XG2Y56BXVKCM7`](https://stellar.expert/explorer/testnet/account/GB2ATSCL5MS6TTT5TRUGXUP4AK2MRKUST5E6S6W7UO4XG2Y56BXVKCM7) — currently 9,999.99 XLM, USDC trustline to be added on first swap

**Code paths**

| Concern | File |
|---|---|
| Aquarius API client (path find, quote) | [`backend/src/routing/aquarius.ts`](../backend/src/routing/aquarius.ts) |
| Swap orchestration (auto-trustline + Soroban router call) | [`backend/src/routing/swap.ts`](../backend/src/routing/swap.ts) |
| Asset registry (XLM/USDC/EURC contract ids) | [`backend/src/routing/assets.ts`](../backend/src/routing/assets.ts) |
| Soroban simulate + submit | [`backend/src/stellar/soroban.ts`](../backend/src/stellar/soroban.ts) |

**Measures of completion**

| Measure | Evidence |
|---|---|
| Asset conversions executed via Stellar Broker / Aquarius on testnet | _pending_ — see PAT-53 |
| Path payments verified on Horizon | _pending_ — see PAT-53 |
| Multi-currency conversion path (local → USDC) | ✅ path-finding covered by `findPath` + `applySlippage` in `aquarius.ts` |

<!-- FILL: PAT-53 - Aquarius swap tx hash + quote details -->
> **Fill-in:** swap tx hash + `RoutingQuote` snapshot once PAT-53 captures the first execution.

---

## D6 — Settlement Engine + SCOUT Reputation Assets

**What's live**

- **50 / 30 / 20 split** enforced deterministically in integer stroops via [`backend/src/stellar/settlement.ts`](../backend/src/stellar/settlement.ts). Sum of parts equals gross by construction (rounding remainder assigned to first driver).
- **SCOUT reputation** implemented as three Classic Assets: `SCOUT1`, `SCOUT2`, `SCOUT3` with **AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED**. Issuer: [`GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4`](https://stellar.expert/explorer/testnet/account/GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4)
- **Tier multiplier** applied on-chain: 1.0× / 1.2× / 1.5× for SCOUT1/2/3. Settlement engine reads the badge on-chain via `getOnchainTier(address)` in [`backend/src/stellar/scout.ts`](../backend/src/stellar/scout.ts), overriding the request's `tier` field.
- **Settlement indexer v1** persists batches with source tx hash + driver payouts, exposed via `GET /v1/settlement/batches[/:id]`. Feeds the future D8 gov dashboard.

**Code paths**

| Concern | File |
|---|---|
| 50/30/20 engine + integer-stroop arithmetic | [`backend/src/stellar/settlement.ts`](../backend/src/stellar/settlement.ts) |
| SCOUT issuer + tier assignment via PulseGen score | [`backend/src/stellar/scout.ts`](../backend/src/stellar/scout.ts) |
| Web SCOUT console | [`web/app/dashboard/scout/page.tsx`](../web/app/dashboard/scout/page.tsx) |
| Settlement explorer UI | [`web/app/dashboard/settlement/page.tsx`](../web/app/dashboard/settlement/page.tsx) |

**Measures of completion**

| Measure | Evidence |
|---|---|
| Revenue split transactions on testnet with correct 50/30/20 distribution | ✅ tx `3b73c013…` shows the settlement source paying Authorities + Treasury; driver payouts routed through SDP |
| Test drivers hold SCOUT tiers visible in Stellar wallets on testnet | ✅ badges are Classic Assets under issuer `GBKGCHRV…SF4` — visible in any Stellar wallet inspecting the driver address |
| Multipliers applied correctly in settlement batches | ✅ verified: submitting all drivers as `tier:1` still paid 1.0/1.2/1.5× because engine reads the on-chain badge, not the request |
| Settlement validated end-to-end | ✅ tx `3b73c013…` on Horizon: [stellar.expert](https://stellar.expert/explorer/testnet/tx/3b73c013dc1f7e1cc7f0dd57b6642421db4e87ddfd11b99c838c10de69c70c47) |

---

## Signers (recap)

The KMS-derived signer [`GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS`](https://stellar.expert/explorer/testnet/account/GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS) is an authorized signer on every protocol service account touched by Tranches 1 and 2 — settlement source, group payout source, SCOUT issuer, AMM routing source. Full KMS setup documented in [`docs/KMS_VERIFICATION.md`](KMS_VERIFICATION.md).

---

## What's blocked externally (not this repo's problem)

- **SDP disbursement evidence (PAT-52):** needs `SDP_BASE_URL` + `SDP_API_KEY` in the local `.env` (Daiwik has these in the Railway deploy env — pending DM)
- **Freighter signed tx (PAT-51):** browser extension flow; either manual sign by a maintainer OR the SEP-10 keypair fallback path

Everything else on Tranche 2 either has evidence above or is in flight on branch `adityasingh456m/tranche-2-evidence`.
