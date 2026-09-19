# Deliverable Modification Request — D5 Cross-Asset Routing

**Deliverable:** D5 — Cross-Asset Settlement Routing
**Change:** Name **Aquarius** as the testnet execution venue; **Stellar Broker** is a quote source
**Filed:** 2026-09-19 · **Status:** awaiting reviewer approval
**Affects:** criterion 5.1 wording only. No code change; no change to what is already running.

---

## 1. What the deliverable currently says

Criterion 5.1 reads *"Asset conversions executed through Stellar Broker on Testnet."*

Our Tranche 2 submission also described the aggregator as Aquarius and Stellar Broker
*"each acting as the other's fallback."* The reviewer is correct that this is wrong, and it is
corrected in §4.

## 2. Why Broker cannot be the execution venue on testnet

`routing/stellarbroker-provider.ts` declares `canExecute: false` and its `execute()` throws
`501 NotImplemented`. That is deliberate, and it is an external block rather than an oversight:

| Requirement | State |
|---|---|
| `STELLARBROKER_PARTNER_KEY` | **Absent.** Blank in `.env.example`, unset in `.env`. Requires partner registration with StellarBroker. |
| Signing authorization | Solvable — `ClientAuthorizationParams` takes a callback, so AWS KMS could sign without materialising a secret. |
| Session shape | A stateful WebSocket (`connect()` → `quote()` → `confirmQuote()` → await `finished`), which does not fit the stateless `RoutingProvider.execute()` signature without an event→promise adapter. |
| **Testability** | **None.** Broker's `estimateSwap()` endpoint is **mainnet-priced**, so Broker quotes fail on testnet and the aggregator falls through to Aquarius. `routing/assets.ts` hard-throws on mainnet (gated behind Phase 5). |

The last row is decisive: even a finished Broker execution bridge **could not be exercised
today**, because Broker prices against mainnet and PathPulse is hard-gated to testnet. Writing
it would produce unverified code and no evidence. We are not proposing to ship that.

## 3. What actually executes, and why it satisfies the deliverable's intent

Aquarius. D5's own scope text calls for routing through *"existing AMM liquidity sources such
as Aquarius"*, so Aquarius is a named venue in the deliverable, not a substitute for one.

Proven on testnet:

| | |
|---|---|
| Transaction | `bf4f8c62a2afcf709e6cd70855a1ce36edc2663a02c28042395bf278f9f5aa3e` |
| Ledger | 4584030 |
| Converted | 10 XLM → **11.517 USDC** (Circle issuer `GBBD47IF…`) |
| Path | 4 hops resolved by Aquarius |
| Result | `successful` |

And routed onward into settlement: `23b28191…` (ledger 4695014) moved the converted USDC to the
settlement source, `a6ba3f88…` (ledger 4695016) settled it 50/30/20 as batch
`stl_1789498668104_c014232e`.

## 4. Correcting the "each acting as a fallback" wording

**Withdrawn:** *"Aquarius and Stellar Broker are quoted in parallel, best execution wins, each
the other's fallback."*

**Replaced with:** Aquarius and Stellar Broker are quoted in parallel and the better **price**
wins the comparison. **Aquarius is the execution venue; Stellar Broker is quote-only.**
Fallback is therefore **one-directional**:

- Broker quote fails → Aquarius still quotes **and** fills. Cost: one lost price comparison.
- Aquarius fails → a Broker quote exists but **cannot be filled**. Cost: the conversion.

Calling that symmetric overstated the redundancy. It is a price cross-check plus a single
execution venue, and it should have been described that way.

Corrected in `docs/TRANCHE2_PROOF_OF_COMPLETION.md` §D5 and `docs/evidence/DEMO_RUNBOOK.md` §4.

## 5. What keeping Broker still buys

Broker is not decorative. It gives an independent price cross-check for audit against the
Aquarius-direct path, and it is the execution route we expect to use at mainnet cutover, when
its mainnet pricing stops being a liability and becomes the point. The provider interface
already carries `canExecute`, so promoting Broker to an execution venue is a flag flip plus the
session bridge — no aggregator change.

## 6. Requested decision

Amend criterion 5.1 from *"executed through Stellar Broker on Testnet"* to:

> **"Asset conversions executed on Testnet through the routing aggregator, with Aquarius as the
> execution venue and Stellar Broker integrated as a parallel quote source. Broker execution is
> deferred to mainnet cutover (Phase 5), where its liquidity is addressable."**

All other D5 criteria stand as submitted.
