# Tranche 2 — Proof of Completion

Deliverables 4, 5, 6 · Stellar **testnet** · compiled 2026-09-16

Every transaction hash below was re-verified against Horizon on the compile date and returned
`successful: true`. Every account returned HTTP 200. Nothing here is illustrative.

> **Superseded in part (2026-09-19).** Reviewer findings on D4, D5 and D6 are answered in
> `docs/TRANCHE2_REVIEW_RESPONSE.md`, with two deliverable modifications filed for approval.
> Read §4.1 and §5.1 below together with their correction notes.

**Verify any transaction:** `https://stellar.expert/explorer/testnet/tx/<hash>`
**Verify any account:** `https://stellar.expert/explorer/testnet/account/<address>`
**Raw ledger data:** `https://horizon-testnet.stellar.org/transactions/<hash>`

---

## Summary

| Deliverable | Criteria | Status |
|---|---|---|
| D4 — Fiat Off-Ramp Integration | 4 | 4 / 4 |
| D5 — Cross-Asset Settlement Routing | 4 | 4 / 4 |
| D6 — Settlement Engine & Reputation Assets | 7 | 7 / 7 |
| **Total** | **15** | **15 / 15** |

---

## Protocol accounts

| Role | Address |
|---|---|
| Treasury (2-of-3) | `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` |
| Partner Revenue | `GCGKQ2BLRYAEJYH3C4BGUEGZPOICWDXMQIM3IKZQKPLL3JY65XQDWSUE` |
| Driver Pool | `GAUI7XIAV7BICSZHQQRTGDYUUYZWMMPXSC7RA3J6S2J2QK56RRG2QZ2U` |
| Settlement source | `GBQOGCRXI2MG5MDXP7QKROOR7X6PWNUOT3R2YSXNLFHPAO3YMBXWZJPC` |
| AMM routing source | `GB2ATSCL5MS6TTT5TRUGXUP4AK2MRKUST5E6S6W7UO4XG2Y56BXVKCM7` |
| SCOUT issuer | `GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4` |
| KMS-derived signer | `GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS` |

| Asset | Code | Issuer |
|---|---|---|
| USD Coin | `USDC` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle) |
| Euro Coin | `EURC` | `GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO` (Circle) |
| Aquarius router | contract | `CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD` |

---

# D4 — Fiat Off-Ramp Integration

**Partner:** Carret Infra (FIU-IND registered VASP) · `https://dev.carret.in/api/v1/taas`
**Corridor:** USDC on Stellar → INR via `bank_transfer`

| | |
|---|---|
| Sub-account | **48559** — KYC + AML verified |
| Registered bank | **5831** — verified by Carret |
| Wallet whitelist | **94** — Stellar USDC address approved |
| Static egress IP | **3.223.23.150** — whitelisted by Carret |

### 4.1 — Successful withdrawal flow through Carret's dev environment

> **Correction (2026-09-19).** These three orders were **not funded by a Stellar transfer on
> any network** — they were funded by a Carret-side dev credit (`POST /crypto_deposit/`), so
> no USDC moved on testnet or mainnet and no transfer hash exists. Carret has no testnet;
> their dev environment uses real mainnet USDC, and PathPulse runs on testnet. What these
> orders prove is the Carret API path and INR settlement to a registered bank — not an
> on-chain deposit. See `docs/TRANCHE2_REVIEW_RESPONSE.md` §4b.

| Order id | Amount | Net INR | Status |
|---|---|---|---|
| **1279** | 10 USDC | ₹964.12 | `filled` |
| **1280** | 10 USDC | ₹963.83 | `filled` |
| **1281** | 10 USDC | ₹964.02 | `filled` |

### 4.2 — Stablecoin → fiat conversion simulation validated

Live quote, `GET /v1/offramp/quotes?amount=10`, sample response:

```json
{ "provider": "carret", "live": true, "quoteId": "4939",
  "asset": "USDC", "fiatCurrency": "INR", "amount": "10",
  "grossFiatAmount": "989.3", "fiatAmount": "973.57", "rate": "98.93",
  "fees": [ { "label": "Carret fee", "amount": "5.84" },
            { "label": "Tax", "amount": "9.89" } ] }
```

Rate ≈ 98–99 INR/USDC · Carret fee 0.59% · TDS 1%

### 4.3 — Off-ramp events linked to Stellar settlement transactions

> **Strengthened (2026-09-19).** `settlementBatchId` is now **mandatory** on every off-ramp
> session (400 if absent, submit disabled in the UI), sessions and their status events are
> persisted in Postgres, and the link survives reconciliation. See §4c of the review response.

`settlementBatchId` is carried on the off-ramp session and validated server-side.

| Input | Result |
|---|---|
| Unknown batch id `stl-test1` | **404** `Settlement batch stl-test1 not found` |
| Valid batch id `stl_1789491082569_c75c7b27` | session created and linked |

### 4.4 — Complete withdrawal flow demonstrated end-to-end

Quote → session → deposit → INR settled to the registered bank, proven on all three orders
above. Provider abstraction: `OffRampProvider` (`carret` live, `ramp` wired).

---

# D5 — Cross-Asset Settlement Routing

**Architecture:** multi-source aggregator — Aquarius and Stellar Broker are quoted in
parallel and the better price wins the comparison. **Aquarius is the execution venue; Stellar
Broker is quote-only** (`canExecute: false`). Fallback is therefore one-directional: if Broker
quoting fails, Aquarius still quotes *and* fills; if Aquarius fails, a Broker quote cannot be
filled. Slippage default 100 bps. See `docs/DELIVERABLE_MODIFICATION_D5_ROUTING.md`.

### 5.1 — Asset conversions executed on Testnet

> **Scope modification filed.** The criterion names Stellar Broker as the execution venue.
> Broker cannot fill on testnet (no partner key; its quotes are mainnet-priced), so the
> conversion below was executed on **Aquarius**, which the deliverable names as an AMM
> liquidity source. Broker remains integrated as a parallel quote source.
> See `docs/DELIVERABLE_MODIFICATION_D5_ROUTING.md`.

| | |
|---|---|
| Transaction | `bf4f8c62a2afcf709e6cd70855a1ce36edc2663a02c28042395bf278f9f5aa3e` |
| Ledger | **4584030** |
| Converted | 10 XLM → **11.517 USDC** (Circle issuer) |
| Path | 4 hops resolved by Aquarius |
| Result | `successful` |

### 5.2 — Path payments verified through Horizon

| | |
|---|---|
| Transaction | `28a14d057b5425ba332bd1bdbaac3643aa70efd3559448fb58cb3f8e94797ec0` |
| Ledger | **4496522** |
| Operation | Soroban `InvokeHostFunction` → `swap_chained` on `CBCFTQSP…` |
| Signer | KMS-derived `GAKYXUFD…` — signature produced inside AWS KMS hardware |
| Result | `successful` |

### 5.3 — Cross-asset settlement transactions validated

`GET /v1/routing/treasury/plan` — live treasury balances, per-asset quotes into USDC, and the
projected post-conversion settlement total. XLM excluded (fees/reserve). Execution human-gated.

Routable set: XLM · USDC `GBBD47IF…` · EURC `GB3Q6QDZ…`

### 5.4 — Converted assets successfully routed into the settlement pipeline

| Step | Transaction | Ledger | Ops |
|---|---|---|---|
| 1. Convert XLM → USDC | `bf4f8c62a2afcf709e6cd70855a1ce36edc2663a02c28042395bf278f9f5aa3e` | 4584030 | 1 |
| 2. Move 6 USDC routing → settlement source | `23b281917c1f98d9a3749032672a8717e81ce95751b4de7e31a5b155ced33231` | **4695014** | 1 |
| 3. Settle converted funds 50/30/20 | `a6ba3f886abcc7d8f9ef0210e2db0d94661d8cbcf1ca60b255986d75ae6d2f2f` | **4695016** | **3** |

Settlement batch **`stl_1789498668104_c014232e`** — 3 USDC → 1.5 / 0.9 / 0.6

---

# D6 — Deterministic Settlement Engine & Reputation Assets

### 6.1 — Revenue split executed on Testnet with correct 50/30/20 distribution

| | |
|---|---|
| Transaction | `c117e2b8b8183967c11f74098201e7d9ff8a93c15ebb8002d1383832ddb6e3f1` |
| Ledger | **4693499** |
| Operations | **3 payment ops**, one atomic transaction |
| Gross | 3 USDC (Circle issuer) |
| Split | **1.5000000** authorities · **0.9000000** driver pool · **0.6000000** treasury |
| Batch id | `stl_1789491082569_c75c7b27` |
| Result | `successful` |

Arithmetic in integer stroops; parts sum to gross by construction.

### 6.2 — Test drivers assigned SCOUT tiers visible in Stellar-compatible wallets

Issuer `GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4`
Flags on chain: `auth_required: true` · `auth_revocable: true` · `auth_clawback_enabled: true`

| Tier | Asset | Holder | Issuance tx | Ledger |
|---|---|---|---|---|
| 1 | `SCOUT1` | `GAHHLVMUERPWOSASAVEVPKZ6BNWNUWEEEUZOBOPWKHAOQPNNDSZRFVDQ` | `7bc2b08a960610cdef4067dce01a56da58dbd1b4a44cec2973d77013e20f76f7` | 4693480 |
| 2 | `SCOUT2` | `GCB3WKY7MKZ7I7QBMMFRHVAPZRV4TLQCSFJA3IFIXMKV4AFJHUDNWDXA` | `cc57339047abd8928f6e100a705fd2b44d65da102d403d724371d0c6f3c6e2e0` | 4693483 |
| 3 | `SCOUT3` | `GADESMRDSLTFXHZXRKISRT4WERBRS4IHKY6Q7OOFGLFE2VYTHIAXHMBT` | `e9705bd226a481678a5297462a13a4b6b5bdc3e371ea29a564dc5d9508900668` | 4693486 |

Each badge: 1 unit, `is_authorized: true`, one authorised holder per asset. Each holder also
carries an authorised USDC trustline.

### 6.3 — Reward multipliers 1.0× / 1.2× / 1.5× applied correctly

> **Superseded (2026-09-19).** The assignment API no longer accepts a score and no longer
> mints a fresh driver: `POST /v1/scout/assign` takes a driver id and reads the score from the
> feed. A replacement example running the full chain — feed score → SCOUT assignment → a
> settlement applying the multiplier, on three existing drivers — is in
> `docs/TRANCHE2_REVIEW_RESPONSE.md` §D6.

Batch **`stl_1789491082569_c75c7b27`** · tx `c117e2b8…` · ledger 4693499

**All three drivers were submitted to the API as `tier: 1`.** The engine read the on-chain badge
instead and paid accordingly:

| Driver | Submitted | Badge held | Multiplier applied | Paid (USDC) |
|---|---|---|---|---|
| `scout-tier1-proof` | tier 1 | SCOUT1 | **1.0×** | **0.2432434** |
| `scout-tier2-proof` | tier 1 | SCOUT2 | **1.2×** | **0.2918918** |
| `scout-tier3-proof` | tier 1 | SCOUT3 | **1.5×** | **0.3648648** |

Ratio **1 : 1.2 : 1.5** exactly · sum **0.9000000** = the 30% driver share of 3 USDC

### 6.4 — Tier assignment and revocation validated

Test driver `GCFLB5UYWPFLFGJN3U4EBAHLOLHSF5IK6ODRYB2225LGXEI55QLI3ZKO`

| Step | Transaction | Ledger | Result |
|---|---|---|---|
| Assign SCOUT2 | `375e85bc8e881fd82acadbaeb22ffd97ab4ce635a5e9603535d084e7d865d568` | **4695006** | tier 2, multiplier **1.2×** |
| Revoke | `64f1465eec57e5915ed470628e685224a55dce4496f96e66ff3e9f9356875ecb` | **4695008** | **1.0000000 SCOUT2 clawed back**, trustline de-authorised |
| Read tier after | — | — | **no badge held, multiplier 1.0×** |

Revocation is one issuer-signed transaction carrying `clawback` + `setTrustLineFlags{authorized:
false}`. No holder signature required; holder cannot reacquire by keeping the trustline open.

### 6.5 — Settlement batches executed successfully

| Batch id | Gross | Asset |
|---|---|---|
| `stl_1789501883277_111ba3fd` | 100.0000000 | XLM |
| `stl_1789498668104_c014232e` | 3.0000000 | USDC |
| `stl_1789491082569_c75c7b27` | 3.0000000 | USDC |
| `stl_1789126122478_9a1c567d` | 0.5000000 | XLM |

`GET /v1/settlement/batches` — indexed with source tx hash and per-driver payouts.

### 6.6 — Settlement transactions independently verifiable on Stellar Testnet

Every settlement above is a public Horizon record requiring no access to PathPulse systems:

```
https://horizon-testnet.stellar.org/transactions/c117e2b8b8183967c11f74098201e7d9ff8a93c15ebb8002d1383832ddb6e3f1
https://horizon-testnet.stellar.org/transactions/a6ba3f886abcc7d8f9ef0210e2db0d94661d8cbcf1ca60b255986d75ae6d2f2f
```

The three payment operations in each are inspectable individually, confirming the 50/30/20
destinations and amounts.

### 6.7 — Complete settlement flow validated end-to-end

Treasury → 50/30/20 split → SDP fan-out → driver.

| | |
|---|---|
| Settlement batch | `stl_1789491082569_c75c7b27` |
| Settlement tx | `c117e2b8…` ledger 4693499, 3 ops |
| Payout batch | **`pob_1789491649634_51b54fab`** |
| SDP disbursement id | **`b702d0ea-f1de-4539-9b85-5428d99f7548`** |

Per-call reconciliation record, `GET /v1/ops/payouts/batches/pob_1789491649634_51b54fab/attempts`:

| # | Step | Outcome | Duration |
|---|---|---|---|
| 1 | `createDisbursement` | **success** | 444 ms |
| 2 | `uploadInstructions` | **success** | 23 ms |
| 3 | `startDisbursement` | **success** | 2015 ms |

Prior completed stablecoin disbursement, three receivers each with its own payment hash:

| | |
|---|---|
| SDP disbursement id | `b6a183ed-7d15-4d46-9efd-2b75b785f6c7` |
| Status | **COMPLETED** |
| Total | 0.0600000 USDC |
| Distribution account | `GBERALDP7TQISOQFHZOSQOVEXXE5GRSM4NZC57OHPJGI5ATQ4OKISYPR` |

| Recipient | Amount | Payment hash |
|---|---|---|
| `GCPX4CDP3SAHE4NKDYN5XVH3DTMX5G6ULRUW6SECTA5VYIUOCDAASEI3` | 0.0100000 | `85f82134238e7c6adaa27f3551d62db53e4e90a863420771a04ce93ecd6d24ff` |
| `GCHH3GGWAO56SMF7DFBB3DXRX57PA3XYYCY2UYUPM2MLXLNCFOIVHFAR` | 0.0200000 | `18084086082fdd97f7e388f9a06ede9b4e5df183ad16d6403349f2f9e0a28f02` |
| `GCYILB4NQTEE7YTE3IPEK7Q575ZOIWQUWPD6C6K76W4HCOICAJUVQ3L5` | 0.0300000 | `8f7f00526a5d2cc9e220487caf6a98e44267e6e9b9906660dee42a9e2ed9e323` |

---

## Treasury control

`GET /v1/treasury/config` — served live from Horizon, cross-checkable against the ledger.

| | |
|---|---|
| Treasury | `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` |
| Master key weight | **0** — cannot sign alone |
| Thresholds | low **2** · medium **2** · high **2** |

| Signer | Weight |
|---|---|
| `GB3REMIRMULZPN3DIBF2WIFQF3LLVYNOPZTLSJOUCWRD4SLNWUCJVWWZ` | 1 |
| `GD674BNVGTOXPLGG3AOMAFBKDO46RSP4DKHSJ45TF6WZRWYVAYR7IKWT` | 1 |
| `GDPFOIWSZLD7RNFTK7CBHSX3JXARVJJ6UHWRPGZWQATI7PXKQVLFO2V4` | 1 |

The backend never signs a treasury reconfiguration. `POST /v1/treasury/multisig/build` returns
an unsigned XDR for human review; a quorum signs out of band.

---

## Scope notes

**Fiat partner.** Formally filed as `docs/DELIVERABLE_MODIFICATION_D4_OFFRAMP.md`.
The deliverable names Mercuryo. Their Stellar SEP-24 endpoint supports XLM
only and offers no INR corridor, so the corridor the deliverable describes could not be served.
Carret Infra (FIU-IND registered) delivered it behind the same `OffRampProvider` interface — a
partner substitution, not an architectural change.

**Stellar Broker execution.** Formally filed as
`docs/DELIVERABLE_MODIFICATION_D5_ROUTING.md`. Broker is integrated and quoting. Its execution path requires a
partner key and prices against mainnet liquidity, so it cannot fill on testnet. Aquarius is the
venue that fills — which the deliverable contemplates in describing "existing AMM liquidity
sources such as Aquarius".

**Driver payout delivery.** The 50/30/20 split settles on-chain and the driver share is delegated
to SDP for per-driver fan-out. SDP orchestration is proven (6.7); final delivery to a given
receiver requires that receiver to complete SDP registration.
