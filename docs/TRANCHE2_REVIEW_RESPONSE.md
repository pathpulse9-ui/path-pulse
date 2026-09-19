# Tranche 2 — Response to Review

Compiled 2026-09-19 · Stellar **testnet** unless stated otherwise

Two formal deliverable modifications are filed alongside this document and require your
approval:

- `docs/DELIVERABLE_MODIFICATION_D4_OFFRAMP.md` — Mercuryo → Carret Infra
- `docs/DELIVERABLE_MODIFICATION_D5_ROUTING.md` — Aquarius as the testnet execution venue

---

## D4 — Off-ramp

### 4a. Formal deliverable modification for Carret

Filed: **`docs/DELIVERABLE_MODIFICATION_D4_OFFRAMP.md`**.

Summary of the case: Mercuryo is not a Stellar SEP-24 anchor (it is a card-based ramp with a
B2B REST API), it offers no INR corridor, and its Stellar support covers XLM only — so the
corridor D4 exists to serve could not be served by the named partner. Carret Infra, an
FIU-IND-registered Indian VASP, serves USDC-on-Stellar → INR natively and sits behind the
unchanged `OffRampProvider` interface. The document maps every Mercuryo sandbox criterion to
its Carret equivalent and records, in §5, exactly what the substitution costs.

### 4b. Which network funded orders 1279 / 1280 / 1281, and the transfer hashes

**Neither. No Stellar transaction exists for these three orders, on testnet or mainnet, and we
should not have presented them in a way that implied one.**

The three orders were funded by a **Carret-side dev credit** (`POST /crypto_deposit/`),
hand-approved by Carret in their dev environment. No USDC moved on any Stellar network, so
there is no transfer hash to provide. What those orders do prove is the Carret API path —
quote → order → fill → INR to a registered bank — and nothing about an on-chain deposit.

Why it happened this way:

- **Carret has no testnet.** Their dev environment transacts real mainnet USDC and real INR
  banking. There is no Carret sandbox in the sense criterion 4.1 assumes.
- **PathPulse runs `STELLAR_NETWORK=testnet`,** and the backend *refuses* to place a Carret
  order on testnet unless `CARRET_ALLOW_TESTNET=true` is set as an explicit dev override
  (`carretLiveProvider.start`, `backend/src/services/offramp.ts`). That guard exists because
  sending testnet USDC to a mainnet deposit address destroys the funds silently.
- **So a testnet settlement batch cannot fund a Carret deposit.** The two ledgers are
  different networks. Any link between them is necessarily a record-level link.

**On the `"live"` label.** It described the *quote*, not a funded order: `GET /v1/offramp/quotes`
returns a real Carret quote id, rate, fee and TDS from Carret's API rather than a local
estimate. The badge was ambiguous and now reads **`live quote · carret · #<id>`**.

**What we propose.** An on-chain off-ramp deposit linked to a settlement batch is achievable
only on mainnet. We would rather carry it as a Phase 5 mainnet-cutover criterion than claim it
here. In the meantime the record-level link has been made mandatory and auditable — §4c.

### 4c. Persistence, the reconciler, and a demonstrated recovery

Three defects, all fixed:

| Defect | Before | Now |
|---|---|---|
| Sessions in process memory | A restart lost every in-flight withdrawal | `off_ramp_sessions` table; `services/offRampStore.ts` |
| No status history | Only the current status existed | `off_ramp_status_events` — one row per transition, tagged `create` / `poll` / `webhook` / `reconciler` |
| Reconciler log-only | **Worse than reported: it queried an `off_ramp_sessions` table that was never created**, caught the error and returned zero rows. Every pass since it shipped was a silent no-op. | Reads Carret's order list, matches, flips status, records the event |
| Batch id optional in UI | Sessions could exist unlinked | **Mandatory** — `400` from the API, submit disabled in the web form |

The reconciler recovers two distinct failures:

1. **Missed callback** — the session holds a Carret order id but the webhook never arrived.
   The order is re-read and its status applied.
2. **Interrupted session** — `place_order` timed out, so the order id was never learned.
   Carret's order list is matched on `(asked_quantity, created_at ±5min)`, the order is bound
   to the session, then its status is applied. An order already claimed by another session is
   refused, so one Carret order can never be credited to two withdrawals.

**A bug this work surfaced:** Carret returns `created_at` as a Unix epoch **float in seconds**
(`1787125834.933947`), not an ISO string. Read naively as milliseconds that lands in January
1970, and every live amount-and-time match would have failed silently. Normalised in
`carretTimestampMs()`, with a regression test.

**How to see it.** `GET /v1/offramp/sessions/:id/events` returns the persisted timeline.
`POST /v1/ops/offramp/reconcile` (ops role) triggers a pass and returns the outcome per
session. A full transcript is produced by:

```
pnpm --filter @pathpulse/backend exec tsx scripts/demo-offramp-recovery.ts \
  --batch stl_1789491082569_c75c7b27 [--order 1279]
```

Recorded output, against a real settlement batch:

```
── 1. session persisted, webhook deliberately never delivered ──
{ sessionId: 'ofr_demo_1789830153405_0f666026',
  status: 'pending_anchor',
  carretOrderId: 'demo-efb6df',
  settlementBatchId: 'stl_1789491082569_c75c7b27' }
Carret says this order is "filled". PathPulse still believes it is pending.

── 2. reconciler pass ──
{ scanned: 1, recovered: 1, unmatched: 0, failed: 0 }
{ sessionId: 'ofr_demo_1789830153405_0f666026',
  settlementBatchId: 'stl_1789491082569_c75c7b27',
  carretOrderId: 'demo-efb6df',
  matchedBy: 'order_id',
  from: 'pending_anchor', to: 'completed', action: 'recovered' }

── 3. session after recovery ──
{ status: 'completed', settlementBatchId: 'stl_1789491082569_c75c7b27' }

── 4. persisted status event timeline ──
2026-09-19T15:02:34.316Z  pending_anchor → completed  [reconciler]
```

The settlement batch link is carried through recovery — that is asserted, not merely observed.

Automated coverage: `backend/src/services/orphanReconciler.test.ts` — 6 tests against live
Postgres (missed callback, interrupted session, out-of-window non-match, double-credit refusal,
epoch normalisation). Backend suite: **98 tests, all passing.**

### 4d. Redacted Carret order record

Order **1279**, read live from `GET /offramp/orders/` on account 48559 today. Counterparty PII
(account holder name, email) and bank identifiers are redacted; everything else is verbatim.

```json
{
  "id": 1279,
  "asset": "USDC",
  "side": "sell",
  "order_type": "limit",
  "status": "filled",
  "asked_quantity": "10.0000000000",
  "filled_quantity": "10.0000000000",
  "quote_ccy": "INR",
  "price": "97.9700000000",
  "avg_price": "97.9700000000",
  "final_cost_to_user": "964.1200000000",
  "fee": "5.7800000000",
  "tds": "9.8000000000",
  "blocked_fund": "0.0000000000",
  "payment_method": "bank_transfer",
  "created_at": 1787125834.933947,
  "filled_time": 1787125834.956738,
  "quote_id": 4904,
  "account_id": 48559,
  "account_info": "[redacted — KYC-verified sub-account holder]",
  "bank_id": "[redacted — registered bank 5831]",

  "pathpulse_session_id": "[no session — see note]",
  "pathpulse_settlement_batch_id": "[no batch — see note]",
  "stellar_tx_hash": null
}
```

Timestamps in ISO: created **2026-08-19T07:50:34.933Z**, filled **2026-08-19T07:50:34.956Z**
(23ms later — Carret's dev environment fills immediately against the hand-approved deposit).

**Note, stated plainly.** Order 1279 predates the persistence work and was placed directly
against Carret during integration, so it carries **no PathPulse session id and no settlement
batch id** — the fields the reviewer asked for do not exist for it, and we will not
retro-fit them. Every order placed from now on carries both by construction: a session cannot
be created without a settlement batch id, and the session is persisted with the Carret order id
before the order is polled. Running the script above with `--order 1279` emits this same record
with a live session and batch bound to it.

---

## D5 — Stellar Broker

Filed: **`docs/DELIVERABLE_MODIFICATION_D5_ROUTING.md`**. We are taking the second option —
**re-scoping so Aquarius is the testnet execution venue** — rather than executing through
Broker, because Broker execution cannot be exercised at all today: there is no
`STELLARBROKER_PARTNER_KEY`, and Broker's quotes are mainnet-priced while `routing/assets.ts`
hard-throws on mainnet. Writing the bridge would produce unverified code and no evidence.

**The wording is corrected.** Withdrawn: *"each acting as the other's fallback."* Replaced with:

> Aquarius and Stellar Broker are quoted in parallel and the better **price** wins the
> comparison. **Aquarius is the execution venue; Stellar Broker is quote-only**
> (`canExecute: false`). Fallback is one-directional — a failed Broker quote costs a price
> comparison; a failed Aquarius costs the fill.

Corrected in `docs/TRANCHE2_PROOF_OF_COMPLETION.md` §D5 and `docs/evidence/DEMO_RUNBOOK.md` §4.

---

## D6 — PulseGen → SCOUT → settlement

### What was wrong

The reviewer is right: `POST /v1/scout/assign` took `{ score }` from the request body and
minted a **brand-new random driver** for each assignment. Neither half of the criterion was
met — the score was operator input, and the driver was not an existing one.

### What changed

- `POST /v1/scout/assign` now takes **`{ driverId }`** and nothing else. The score is read from
  `scoreProvider()` for that driver. **There is no way to pass a score to the API.**
- The badge is granted to the driver's **existing managed wallet** — the account they are
  already paid into — not to a fresh keypair. A driver with no wallet is rejected.
- Assignment is idempotent, and a lower badge is revoked before a higher one is granted, so a
  driver never holds two.
- `ScoutAssignment` now carries `scoreSource` and `scoredAt`, surfaced in the web table, so a
  synthetic score can never be read as one PulseGen issued.
- The web form's score input is gone; it takes a driver id.

A settlement request no longer carries a tier at all: `tier` is optional in the contract, the
console omits it, and the engine resolves every multiplier from the on-chain badge. The previous
console demo, which minted drivers and asserted tiers 1/2/3 in the request, has been replaced by
`POST /v1/ops/demo/scout-drivers`, which runs the same score → badge path as the CLI.

Each settlement payout now also records the score behind its multiplier **at settlement time**,
so a later rescore cannot rewrite why a past batch paid what it paid. The government drill-down
(D8) shows that score, its source and its delivery batch beside every payout.

### On the score feed itself

PulseGen is an external dependency, and the 75-day plan's own risk register anticipated this:

> *"PulseGen score feed availability → SCOUT tier assignment (Phase 4) needs real scores →
> Define score-feed contract in Phase 1; use synthetic scores until the live feed lands."*

**That contract is now written and attached: `docs/SCORE_FEED_CONTRACT.md`.** It specifies tier
derivation, the live-feed interface, batch delivery, provenance, the guarantees above, and a
section for PathPulse.ai to define what a score measures — which is theirs, not ours.

Three sources are implemented, tried in order, each recording which one answered:

| Source | State |
|---|---|
| `pulsegen` live REST | Implemented; activates the moment `PULSEGEN_BASE_URL` + `PULSEGEN_API_KEY` are set |
| `pulsegen` delivered batch | **Live now** — JSON or CSV via `POST /v1/ops/scores/import`, with provenance |
| `synthetic` interim | Deterministic per driver id; refused on mainnet at boot |

Batch delivery matters because scoring need not be an API to be real: a spreadsheet export from
PathPulse.ai is a genuine validation result. Every delivery records supplier, arrival time,
importing operator and a SHA-256 of the exact payload, and every score points at its batch.

> The provenance attests to **receipt, not correctness** — that a named party supplied these
> numbers at a known time, not that they are right. Nothing here validates a score; that is
> PulseGen's job. We have been careful not to let an import path launder a number into
> something that looks authoritative.

Until then the synthetic feed is **deterministic per driver** — the score is derived from a
SHA-256 of the driver id, so the same driver always scores the same, a tier is reproducible by
anyone holding the driver id, and **no operator can hand-pick a tier**. That is the substantive
fix: the objection was operator-chosen scores, and operator choice is now impossible whichever
feed is active.

### The example, end to end

Three existing drivers, scores read from the feed, badges assigned from those scores, one
settlement reading the badges from chain. **Every driver was submitted to the API as `tier: 1`**
— the engine ignored it and used the on-chain badge.

| Driver | Score (feed) | Tier | Multiplier | Assignment tx |
|---|---|---|---|---|
| `drv-pulsegen-demo-002` | 0.117425 | SCOUT1 | 1.0× | `7964379cb7856d11018ac74c20f3f3eb88178f08e7575cc2f53258f2021ee576` |
| `drv-pulsegen-demo-003` | 0.622617 | SCOUT2 | 1.2× | `89d0e59f003d8a3b71ebb0f6c18c3590227502c045e65a67b5a02b6b5d379579` |
| `drv-pulsegen-demo-006` | 0.832951 | SCOUT3 | 1.5× | `d15cef88cc99f305789c54ff6d4178442d1bc110de0b7f9c38dfb76e64a8a73f` |

Settlement batch **`stl_1789830562621_67238dce`**, tx
**`7c65bb1e8545305c09c98532b270673b40ac9ce7d482c5ee5f3f5c57cc9aa3c9`** — 1 USDC gross,
split 0.5 / 0.3 / 0.2:

| Driver | Submitted | Badge read from chain | Paid (USDC) | Ratio |
|---|---|---|---|---|
| `drv-pulsegen-demo-002` | tier 1 | SCOUT1 | 0.0810812 | 1.0000× |
| `drv-pulsegen-demo-003` | tier 1 | SCOUT2 | 0.0972972 | 1.2000× |
| `drv-pulsegen-demo-006` | tier 1 | SCOUT3 | 0.1216216 | 1.5000× |

Ratio **1 : 1.2 : 1.5** exactly · sum **0.3000000** = the 30% driver pool.

Reproduce: `pnpm --filter @pathpulse/backend exec tsx scripts/demo-pulsegen-to-settlement.ts`
(add `--reassign` for fresh assignment transactions).

**Proven again through the delivery path.** Simulating a client export (import
`imp_1789851963715_40d7c70e`, supplier PathPulse.ai, SHA-256 recorded) and settling with **no
tier in the request**: batch `stl_1789853258070_e1eba325`, tx
`6da1a8204184e5d8bade541b8794975a71d8342e3d85c5ce3775439a0e740831`.

| Driver | Score | Source | Badge read from chain | Paid (USDC) |
|---|---|---|---|---|
| `…demo-002` | 0.2140 | `pulsegen` | SCOUT1 · 1.0× | 0.0810812 |
| `…demo-003` | 0.6480 | `pulsegen` | SCOUT2 · 1.2× | 0.0972972 |
| `…demo-006` | 0.9120 | `pulsegen` | SCOUT3 · 1.5× | 0.1216216 |

> Those scores came from a **simulated** delivery standing in for PathPulse.ai's real export —
> we are not presenting them as genuine PulseGen output. The mechanism is what is proven: swap
> in your real numbers and the identical command produces the identical evidence. Since PulseGen
> is PathPulse.ai's system, the scores themselves are the one thing we cannot supply. Send
> validation results for three contributors in any form — API, CSV, or the numbers in an email —
> and we will re-run this and return the transcript.

---

## Accounts

### Why they differ from T1

The T1 accounts were not swapped for convenience. **They were structurally incapable of holding
USDC, which is the asset PathPulse settles in.**

`backend/scripts/provision-testnet.ts` printed the distribution-account secrets to **stdout
only** and never wrote them to disk — only public keys were saved. The seeds are unrecoverable.
An account whose seed is lost can never sign a `changeTrust`, so it can never hold an issued
asset. Verified on Horizon today:

| T1 account | Role | Holdings today | USDC trustline |
|---|---|---|---|
| `GA3XFACID4PFYYADQBXUVKT2B6OB3QQDVGUDHYBYFISBZKD5C45CGMAY` | Partner Revenue | XLM only | **none — impossible to add** |
| `GD2J6WSBGITCNDH4AA3FMMQVUMHWIL2KL4DHQGXKENAJAR3TNDJXXGGU` | Driver Pool | XLM only | **none — impossible to add** |
| `GADPEI5OQHNMU5KZ4WBC4QK5N6OQSEZJQLRF5X2NIVHL74KVLWGREN4M` | Treasury | XLM only | **none — impossible to add** |

Because a settlement is one atomic transaction paying all three, the driver pool's missing
trustline meant **USDC settlement failed end-to-end**. It went unnoticed because every earlier
proof had used XLM.

**The treasury had a second, independent defect.** `GADPEI5O…` was configured with thresholds
2/2/2 and four weight-1 signers — *master included*. Stellar counts the master key as a signer,
so it was a **2-of-4, not the 2-of-3 we documented**. Its three non-master secrets were lost
too, and master alone is weight 1 against a threshold of 2 — so it can authorize neither a
payment nor a `set_options` to repair its own signer set. **It is permanently frozen.** The
discrepancy is on-chain in its only transaction,
`96e0090852c6c0d2f5806a8657f92752b3133d11e52d717dad9fe3db27097dcd`, whose fourth operation sets
`master_key_weight: 1` alongside the 2/2/2 thresholds.

### The replacements

| Role | Address | Provisioned |
|---|---|---|
| Treasury (2-of-3) | `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` | 2026-08-25 |
| Partner Revenue | `GCGKQ2BLRYAEJYH3C4BGUEGZPOICWDXMQIM3IKZQKPLL3JY65XQDWSUE` | 2026-08-30 |
| Driver Pool | `GAUI7XIAV7BICSZHQQRTGDYUUYZWMMPXSC7RA3J6S2J2QK56RRG2QZ2U` | 2026-09-11 |

All three now hold USDC. The provisioning scripts persist secrets rather than printing them —
the specific mistake that caused this cannot recur.

**Key storage.** AWS KMS is in service (`SIGNER_BACKEND=aws-kms`): `alias/pathpulse-stellar-signer`
(`ECC_NIST_EDWARDS25519`, `ED25519_SHA_512` / `MessageType: RAW`) signs for the protocol service
accounts, and `alias/pathpulse-kek` wraps the key-encryption key that seals driver seeds. The
KMS-derived signer `GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS` is added
**alongside** each account's existing signer, never as the sole one — so losing the KMS key
degrades signing but cannot strand an account, which is the failure mode that froze
`GADPEI5O…`. The two distribution accounts are next in line for the same treatment.

The treasury is **deliberately not** KMS-held. It is a human-gated 2-of-3; placing all three
signers behind the backend would let the backend move treasury funds alone and defeat the
quorum. Its remediation is distribution to separate signatories, below.

USDC settlement proven after the fix: tx
`4d123cc4c743d73800aeff76adb98d5e1fbe2ae9220a5b2a004c2bdf99f051c8` (ledger 4618964), 3 USDC
split 1.5 / 0.9 / 0.6. Driver pool trustline:
`5adcbf22a55f6bb51904ea369750a2597f0ea843e5f25c79188763dfc9c9c649`.

### New treasury — signers, weights, thresholds

Read from Horizon on 2026-09-19. Cross-checkable at
`https://horizon-testnet.stellar.org/accounts/GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2`
or via `GET /v1/treasury/config`.

| Signer | Weight | |
|---|---|---|
| `GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2` | **0** | **master key — cannot sign at all** |
| `GB3REMIRMULZPN3DIBF2WIFQF3LLVYNOPZTLSJOUCWRD4SLNWUCJVWWZ` | 1 | |
| `GD674BNVGTOXPLGG3AOMAFBKDO46RSP4DKHSJ45TF6WZRWYVAYR7IKWT` | 1 | |
| `GDPFOIWSZLD7RNFTK7CBHSX3JXARVJJ6UHWRPGZWQATI7PXKQVLFO2V4` | 1 | |

| Threshold | Value |
|---|---|
| low | **2** |
| medium | **2** |
| high | **2** |

Total signing weight **3** against a threshold of **2** — a genuine 2-of-3, with the master key
explicitly disabled. `buildTreasuryMultisigTx` now sets `masterWeight: 0` so the original defect
cannot be reproduced.

Evidence:

- Configuring tx `9f93fc82ac8e6a1268fd470cb8c58175d123d6f5112065cabcb047622eb30856`
- Two-signer proof `4face5e7ffaa2c77bf9477a8ba775b773c33ef24ff6c9114861d3d6c28a93722` (2 signatures)
- Quorum-signed `setOptions` adding the USDC trustline
  `8746013f4ea54b749ecb69f66b8527b7b867aebd66d4a071c84fb114100d6df0`

The backend never signs a treasury reconfiguration. `POST /v1/treasury/multisig/build` returns
unsigned XDR for human review; a quorum signs out of band.

### Disclosure — signer distribution is not yet done

The on-chain 2-of-3 is real, but **all three signer secrets currently sit in one file on one
machine** (`secrets/treasury-v2.json`, mode 0600, gitignored). Operationally that is a 1-of-1
until they are distributed to separate holders, and we would rather say so than have it found.

Remediation, tracked in `docs/CUSTODY.md`: distribute the three secrets to separate signatories,
and decide the final treasury shape — three independent human signatories, or two humans plus
one KMS-held signer. Distribution is a mainnet-cutover prerequisite and we are not claiming it
as complete. KMS itself is already in service for the service accounts (above); what is
outstanding is the treasury quorum being held by three separate people rather than one file.

---

## Summary of changes made in response

| Area | Change |
|---|---|
| D4 | `off_ramp_sessions` + `off_ramp_status_events` tables; `offRampStore.ts`; reconciler completed; `settlementBatchId` mandatory; epoch-timestamp bug fixed; `"live quote"` label |
| D4 | New: `GET /v1/offramp/sessions/:id/events`, `POST /v1/ops/offramp/reconcile` |
| D5 | Fallback wording corrected in the proof and the runbook |
| D6 | `assign` takes a driver id, not a score; existing managed wallet as target; three-source feed with precedence; batch delivery with provenance (supplier, time, operator, payload hash); score captured on every settlement payout; settlement `tier` now optional and chain-resolved; console demo no longer asserts tiers; mainnet boot guard against synthetic scores |
| D6 | New: `POST /v1/ops/scores/import`, `GET /v1/ops/scores/imports[/:id]`, `GET /v1/scout/feed`, `GET /v1/scout/score/:driverId`, `POST /v1/ops/demo/scout-drivers` |
| Docs | Two deliverable modifications filed; `docs/SCORE_FEED_CONTRACT.md` (the Phase 1 artefact the plan committed to); this response |
| Scripts | `demo-offramp-recovery.ts`, `demo-pulsegen-to-settlement.ts` |
| Tests | 106 passing (6 reconciler, 8 score-feed) |
