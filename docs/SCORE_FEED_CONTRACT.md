# PulseGen Score-Feed Contract

**Deliverable:** D6 — Settlement Engine & SCOUT Reputation
**Commitment:** 75-Day Plan §7, risk register — *"Define score-feed contract in Phase 1; use
synthetic scores until the live feed lands."* This is that contract.
**Status:** interface specified and implemented · **semantics pending PathPulse.ai** (§6)
**Version:** 1.0 · 2026-09-20

---

## 1. What this contract is for

PulseGen is **PathPulse.ai's own contributor-validation engine**. It is an external dependency
of the settlement system, in the same class as SDP tenancy and the fiat partner: named in the
plan, owned outside this codebase, and integrated behind an interface.

It matters because of what its output does. A validation score maps to a SCOUT tier, and that
tier multiplies a contributor's share of the driver-rewards pool by **1.0×, 1.2× or 1.5×**.
Since the pool is funded from public money and reported to a government dashboard (D8), a score
is not a product metric — it is the justification for paying one contributor more than another
out of public funds, and it has to survive an auditor asking *"why did this person get 50%
more?"*

This document specifies the wire contract. **It does not specify what a score means** — that is
PathPulse.ai's to define (§6).

## 2. Tier derivation — fixed, published, no discretion

| Score | Tier | Asset | Multiplier |
|---|---|---|---|
| ≥ 0.8 | 3 | `SCOUT3` | 1.5× |
| ≥ 0.5 and < 0.8 | 2 | `SCOUT2` | 1.2× |
| < 0.5 | 1 | `SCOUT1` | 1.0× |

Implemented in `scoreToTier()`. Anyone holding a score can derive the tier and check it against
the badge on chain. Nothing between the score and the tier is a judgement call.

## 3. Interface

### 3.1 Live feed (preferred)

```
GET {PULSEGEN_BASE_URL}/v1/drivers/{driverId}/validation-score
Authorization: Bearer {PULSEGEN_API_KEY}
Accept: application/json
```

```json
{ "score": 0.8329, "scored_at": "2026-09-18T09:00:00Z" }
```

| Field | Type | Rule |
|---|---|---|
| `score` | number | 0..1 inclusive. Values outside the range are clamped, not rejected. |
| `scored_at` | ISO-8601 | When PulseGen computed it, not when it was served. |

Timeout 10s. A non-2xx, a malformed body or a timeout falls through to §3.2 — an outage at
PulseGen must not strand a settlement.

Activates automatically once `PULSEGEN_BASE_URL` and `PULSEGEN_API_KEY` are both set.

### 3.2 Batch delivery (interim, live today)

Scoring need not be an API to be real. A delivered export is a genuine validation result, and
this path exists so PathPulse.ai can supply scores in whatever form they already produce them.

```
POST /v1/ops/scores/import      (role: ops)
```

JSON:
```json
{
  "supplier": "PathPulse.ai",
  "sourceRef": "pulsegen-export-2026-09-18.csv",
  "scores": [{ "driverId": "drv-001", "score": 0.83, "scoredAt": "2026-09-18T09:00:00Z" }]
}
```

Or CSV, with a header row:
```
driver_id,score,scored_at
drv-001,0.83,2026-09-18T09:00:00Z
```

**Validation is all-or-nothing.** Any bad row rejects the whole batch — a partial import would
leave some contributors scored and others silently not, while the provenance record claimed
otherwise. Rejected: score outside 0..1, unparseable or future `scoredAt`, empty `driverId`, a
`driverId` twice in one batch, more than 10,000 rows.

### 3.3 Synthetic interim

When no live feed is configured and no batch has been delivered, the score is derived
deterministically from the driver id (first 4 bytes of its SHA-256, divided by 2³²−1).

This is a **test fixture, not a measurement**. It exists so the settlement chain is exercisable
end to end before the feed lands, and it has one useful property: a reviewer can recompute any
tier independently and confirm it was not hand-picked.

```js
require('crypto').createHash('sha256').update(driverId).digest().readUInt32BE(0) / 0xffffffff
```

`config/env.ts` **refuses to boot on mainnet** unless a live feed is configured. A synthetic
score measures nothing, and on mainnet it would pay a real contributor 1.5× forever for no
reason.

### 3.4 Precedence

Live feed → most recent delivered batch → synthetic. Every score records which source answered,
so a synthetic score can never be mistaken for a PulseGen one.

## 4. Provenance

Every delivered batch records:

| Field | Meaning |
|---|---|
| `supplier` | Who delivered it (required) |
| `sourceRef` | Their reference — filename, export id |
| `receivedAt` | When it arrived |
| `importedBy` | The operator who imported it |
| `payloadSha256` | SHA-256 of the exact payload received |
| `scoreCount` | Rows accepted |

Every score points at the batch that delivered it, and every settlement payout captures the
score behind its multiplier **at settlement time** — so a later rescore cannot silently rewrite
why a past batch paid what it paid.

> **What provenance attests to.** That a named party supplied these numbers at a known time.
> **Not** that the numbers are correct. Nothing in this system validates a score's accuracy;
> that is PulseGen's job. Any UI, export or report built on this must preserve the distinction.

Scores are append-only. History is retained so a tier assigned months ago stays explainable.

## 5. Guarantees

1. **No caller-supplied score, ever.** `POST /v1/scout/assign` accepts `{ driverId }` and
   nothing else. There is no code path from a request body to a score. This is structural.
2. **Assignment targets an existing contributor** — their managed wallet, the account they are
   already paid into. A driver with no wallet is rejected.
3. **Settlement reads the badge from chain**, not the request. A `tier` in a settlement request
   is a fallback used only when the driver holds no badge, and callers should omit it.
4. **One badge per driver.** A lower tier is revoked before a higher one is granted.
5. **Unknown driver → tier 1**, never an error. Absence of a score is not a reason to fail a
   settlement.

## 6. For PathPulse.ai to define

The interface above is complete and implemented. The **semantics** are not, and cannot be
specified by EngxLab — they describe PulseGen's judgement, which is PathPulse.ai's product.

| # | Question | Why it matters |
|---|---|---|
| 1 | **What does the score measure?** What do contributors submit, and what makes a submission trustworthy? | Everything else follows from this |
| 2 | **Recompute cadence** — per settlement period, nightly, on demand? | Determines how often badges churn, and each change is an on-chain fee |
| 3 | **Window** — is the score instantaneous or over a trailing period? | A trailing window stops one bad day cutting someone's income by a third |
| 4 | **Staleness** — if the newest score is older than N days, does the driver keep their tier or fall back to 1.0×? | Currently the newest score stands indefinitely |
| 5 | **Demotion policy** — same thresholds both directions, or hysteresis? | Without hysteresis, drivers near a boundary oscillate and income becomes unpredictable |
| 6 | **Explainability** — which component factors can be shown to a contributor who disputes a demotion? | A 1.5× → 1.0× drop is a 33% pay cut; an appeal path needs a reason |

Recommended defaults, for PathPulse.ai to accept or replace: a 30-day trailing window; promote
at ≥0.8 / ≥0.5 but demote only below 0.75 / 0.45; treat a score older than 60 days as stale and
fall back to 1.0×; return component factors alongside the score.

One design note carried from §1: if the exact weighting is published, contributors will optimise
against the function rather than the road. Publish the contract and the thresholds; keep the
weights adversarially robust or unpublished.

## 7. Current state

| Piece | State |
|---|---|
| Tier derivation | ✅ implemented, published |
| Live feed client | ✅ implemented, inert until credentials are set |
| Batch delivery + provenance | ✅ implemented, JSON and CSV |
| Synthetic interim | ✅ implemented, deterministic, mainnet-blocked |
| Score on settlement payouts | ✅ captured at settlement time |
| Ops console visibility | ✅ feed panel, provenance, per-driver scores |
| Tests | ✅ 8 dedicated, 106 backend total |
| **Live PulseGen endpoint** | ⛔ **not available — PathPulse.ai to supply** |
| **Score semantics (§6)** | ⛔ **PathPulse.ai to define** |

## 8. Environment

| Variable | Purpose |
|---|---|
| `PULSEGEN_BASE_URL` | Live feed base URL. Unset → batch or synthetic. |
| `PULSEGEN_API_KEY` | Bearer credential. Both required on mainnet. |

## 9. Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/ops/scores/import` | ops | Deliver a batch (JSON or CSV) |
| `GET /v1/ops/scores/imports` | ops | Delivery history |
| `GET /v1/ops/scores/imports/:id` | ops | One delivery and its scores |
| `GET /v1/scout/feed` | session | Active source, latest delivery, current scores |
| `GET /v1/scout/score/:driverId` | session | Resolved score for one driver |
| `POST /v1/scout/assign` | ops | Assign the tier a driver's score maps to |
