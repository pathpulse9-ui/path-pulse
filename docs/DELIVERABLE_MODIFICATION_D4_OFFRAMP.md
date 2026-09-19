# Deliverable Modification Request — D4 Fiat Off-Ramp

**Deliverable:** D4 — Fiat Off-Ramp Integration
**Change:** Fiat off-ramp partner — **Mercuryo → Carret Infra**
**Filed:** 2026-09-19 · **Status:** awaiting reviewer approval
**Affects:** D4 acceptance criteria only. No change to D5, D6, or the settlement engine.

---

## 1. What the deliverable currently says

D4 names **Mercuryo** as the fiat off-ramp partner and its acceptance criteria are written
against a **Mercuryo SEP-24 sandbox** integration.

## 2. Why it cannot be delivered as written

Three findings from the integration attempt, in order of severity:

| # | Finding | Consequence |
|---|---|---|
| 1 | **Mercuryo is not a Stellar SEP-24 anchor.** It is a card-based ramp with a B2B REST API (`sign-in` → `sell-rates` → `sell` → hosted redirect). | The "SEP-24 sandbox" the criteria describe does not exist to integrate against. |
| 2 | **No INR corridor.** Mercuryo does not offer INR payout. | The corridor D4 exists to serve cannot be served. |
| 3 | **No Stellar-USDC off-ramp.** Their Stellar support covers XLM only; the sandbox lists BTC/ETH/USDT. | PathPulse settles in USDC. Using Mercuryo would require a USDC→XLM bridge hop before every driver withdrawal. |

Any one of these blocks the deliverable. Together they make the named partner unusable for
the corridor D4 was written to deliver.

## 3. What is proposed instead

**Carret Infra** (`https://dev.carret.in/api/v1/taas`), an Indian VASP registered with
**FIU-IND**, serving the corridor **USDC on Stellar → INR** to a registered bank account via
`bank_transfer`.

| Requirement | Mercuryo | Carret Infra |
|---|---|---|
| INR payout corridor | ✗ not offered | ✓ IMPS/NEFT to a registered bank |
| Accepts Stellar USDC directly | ✗ XLM only | ✓ native, no bridge hop |
| Regulatory standing for INR | — | ✓ FIU-IND registered VASP |
| Holds KYC/AML and fiat custody | ✓ | ✓ — PathPulse operates no regulated fiat infrastructure |
| Integration shape | B2B REST + hosted redirect | Pure REST + `API-KEY`, no widget |

**The architecture does not change.** Carret sits behind the existing `OffRampProvider`
interface (`backend/src/services/offramp.ts`). The settlement engine has no knowledge of which
provider is active. The `ramp` provider (Ramp Network) remains wired, and Mercuryo could be
re-added without touching settlement should they ever support USDC-on-Stellar → INR.

## 4. Criterion-by-criterion mapping

| # | Original criterion (Mercuryo) | Proposed replacement (Carret) | Evidence |
|---|---|---|---|
| 4.1 | Successful testnet withdrawal flow through the Mercuryo **SEP-24 sandbox** | Successful withdrawal flow through the **Carret dev environment** | Orders `1279`, `1280`, `1281` — 10 USDC each, `filled`. **See §5 — these were not funded by a Stellar transfer.** |
| 4.2 | Stablecoin → fiat conversion simulation validated | Live Carret quote: `GET /v1/offramp/quotes?amount=10` returns a real Carret quote id, rate, fee and TDS breakdown | Rate ≈ 98–99 INR/USDC, Carret fee 0.59%, TDS 1% |
| 4.3 | Off-ramp events linked to Stellar settlement transactions | **Unchanged and now strengthened** — `settlementBatchId` is mandatory on every off-ramp session, validated server-side, persisted, and preserved through reconciliation | `off_ramp_sessions.settlement_batch_id`; unknown batch → 404 |
| 4.4 | Complete withdrawal flow demonstrated end-to-end | Unchanged — quote → session → order → INR settled to a registered bank | §5 records the exact funding mechanism |

## 5. Disclosure — what this substitution costs, stated plainly

**Carret has no testnet.** Their dev environment transacts **real mainnet USDC** and real INR
banking. There is no Carret sandbox in the sense criterion 4.1 assumes.

Consequences we are not asking the reviewer to overlook:

1. **Orders 1279–1281 were not funded by a Stellar transfer on any network.** They were funded
   by a Carret-side dev credit (`POST /crypto_deposit/`), hand-approved by Carret. **No USDC
   moved on testnet or mainnet, so no Stellar transaction hash exists for them.** What those
   orders prove is the Carret API path and INR settlement to a registered bank — not an
   on-chain deposit.
2. **PathPulse runs `STELLAR_NETWORK=testnet`,** and the backend *refuses* to place a Carret
   order on testnet unless `CARRET_ALLOW_TESTNET=true` is set as an explicit dev override.
   The guard exists because sending testnet USDC to a mainnet deposit address would silently
   destroy the funds. `config/env.ts` refuses to boot on mainnet with that override enabled.
3. **Therefore the off-ramp ↔ settlement link is a record-level link, not an on-chain one.**
   A testnet settlement batch cannot fund a mainnet Carret deposit. §6 describes what we built
   so that this link is auditable rather than decorative.

We would rather state this than let criterion 4.1 read as though a testnet on-chain withdrawal
occurred. It did not.

## 6. What was built in response to review

| Gap | Change |
|---|---|
| Sessions were in process memory; a restart lost them | `off_ramp_sessions` table + `services/offRampStore.ts` |
| No status history | `off_ramp_status_events` — one row per transition, tagged `create` / `poll` / `webhook` / `reconciler` |
| Reconciler was log-only **and querying a table that was never created**, so every pass was a silent no-op | Rewritten: reads Carret's order list, matches by order id or by (amount, created_at ±5min), flips status, records the event |
| Batch id optional in the UI | Mandatory in the API (`400` if absent) and in the web form |
| `"live"` badge ambiguous | Now reads `live quote · carret · #<id>` — it describes quote provenance, never a funded order |

Recovery evidence: `backend/scripts/demo-offramp-recovery.ts` and
`backend/src/services/orphanReconciler.test.ts` (4 tests, green against Postgres).

## 7. Requested decision

Approve the substitution of **Carret Infra for Mercuryo** as the D4 fiat off-ramp partner, and
the replacement of the Mercuryo SEP-24 sandbox criteria with the Carret-equivalent criteria in
§4, on the understanding recorded in §5.

If the reviewer requires an **on-chain** off-ramp deposit linked to a settlement batch, that is
achievable only on mainnet, and we would propose it as a Phase 5 mainnet-cutover criterion
rather than a Tranche 2 one.
