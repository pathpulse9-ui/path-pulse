# Tranche 2 follow-up responses (Stellar review)

Reply draft, plus the code work each answer implies. Read the notes under
each item before you paste — some answers depend on changes that must land
first so the response and the deployed code agree.

---

## D4 — Off-ramp

### D4.1 — Formal deliverable modification: Carret in place of Mercuryo

**Answer we should give:**

> We're filing a formal modification: **D4 shifts from Mercuryo (SEP-24)
> to Carret Infra (REST + webhook)**. Reason: Mercuryo's India off-ramp
> is still limited to the enterprise track that requires an Indian
> licensed money-service business as counterparty, which PathPulse
> doesn't yet hold. Carret Infra is a licensed Indian payments partner
> already onboarded to us (`dev.carret.in`, account `48559`), gives us
> per-driver KYC + INR banking + off-ramp orders, and is the same
> integration shape that the rest of the tranche now depends on
> (SCOUT-tier gating, per-driver settlement fan-out).
>
> The success criteria are unchanged:
> - Fiat off-ramp is initiated from PathPulse and reaches a real Indian
>   bank account.
> - Every off-ramp event is linked to the settlement batch that funded
>   it, verifiable on Horizon for the crypto leg.
>
> What changes is the wire-level protocol: `SEP-24 interactive` becomes
> `REST + HMAC-SHA256 webhook`. The user-facing surface (mobile + web
> off-ramp page) is unchanged. Docs updated at `docs/TESTNET_EVIDENCE.md`
> (D4 section) and `docs/production-launch.md`.

**Code state today:** `OFFRAMP_PROVIDER=carret` on the deployed backend
(`.env`), Carret's HTTP client + off-ramp path live in
`backend/src/services/carret.ts` + `offramp.ts`. Mercuryo code paths
are gone.

**Action before we send this:** none required.

---

### D4.2 — Network + tx hashes for the three filled orders

**The honest state.** The three orders shown as "live" in the off-ramp
UI were placed against Carret's **production API** (`dev.carret.in` — a
production URL despite the `dev` subdomain; Carret has no separate
sandbox for these endpoints).

The backend is running with `STELLAR_NETWORK=testnet` and
`CARRET_ALLOW_TESTNET=true`. That flag is a dev-only escape in
`backend/src/services/offramp.ts:carretLiveProvider.start`:

```
if (env.network === 'testnet' && !env.carret.allowTestnet) {
  throw httpError('Carret off-ramp is mainnet-only ...', 500, 'ConfigError');
}
```

Concretely that means: **the three orders each hit Carret's book and
filled INR, but no Stellar USDC transfer was actually broadcast for
them.** The Stellar deposit step is skipped when the flag is on so the
UI can be exercised end-to-end without spending mainnet USDC.

So we should not claim on-chain tx hashes we don't have. What we can
say honestly:

> The three orders you're seeing were placed against Carret's live REST
> API with `CARRET_ALLOW_TESTNET=true` — a dev-only override in
> `backend/src/services/offramp.ts` that lets us walk the KYC → quote →
> place_order → fill flow end-to-end without broadcasting mainnet USDC.
> The INR settled to a Carret-side bank; no Stellar tx hash exists yet
> because no Stellar USDC transfer was made. This is why the
> `settlement_batch_id` was optional in the UI — we had no on-chain
> settlement to bind those specific fills to.
>
> To meet the D4 success measure we're re-running the full chain on
> **mainnet** with `CARRET_ALLOW_TESTNET=false`. Each new order will
> emit a real USDC payment tx on Stellar mainnet, whose hash we'll
> record on the off-ramp session and expose via
> `GET /v1/offramp/sessions/{id}.txHash` and a
> `stellar.expert/explorer/public/tx/{hash}` link on the receipt
> screen. We'll share three hashes plus the linked settlement batch id
> for each within [X] business days.

**Code work implied before we can send the follow-up "here are the
hashes":**
1. Turn off `CARRET_ALLOW_TESTNET`; flip `STELLAR_NETWORK=mainnet`.
2. Extend `carretLiveProvider.start()` to build + submit the USDC
   payment from the driver's Stellar address to Carret's deposit
   address (with `carretDepositMemo`), then store `session.txHash` +
   `session.network` on the record.
3. Persist `settlement_batch_id` on the session (see D4.3 below —
   already partially wired, needs the DB row).
4. `stellar.expert` link on the receipt page (web + iOS) reading the
   new fields.

Effort: ~4h eng + Ops confirming mainnet USDC treasury balance is
funded.

---

### D4.3 — Persistence + reconciler + one interrupted-session recovery

**The honest state.** Off-ramp sessions live in an in-memory `Map` in
`backend/src/services/offramp.ts:263`:

```
const sessions = new Map<string, OffRampSession>();
```

Between deploys or process restarts, session state is lost. The orphan
reconciler (`backend/src/services/orphanReconciler.ts`) exists but is
log-only — it queries a DB table that doesn't exist for these
sessions, so on production today it emits nothing.

The Carret webhook route at `POST /v1/carret/callback` calls
`applyCarretCallback(orderId, status)` which mutates the in-memory
session. That works for the demo but doesn't survive a restart.

We should say this straight:

> Sessions and status events are not persisted yet — they live in an
> in-memory Map in `offramp.ts`, and the reconciler you saw is
> log-only. We're closing this before we submit T2:
>
> 1. **New tables** in the PathPulse Postgres:
>    - `offramp_sessions` — one row per driver order, columns for
>      `id`, `user_id`, `carret_order_id`, `carret_quote_id`,
>      `amount`, `fiat_amount`, `status`, `settlement_batch_id`,
>      `tx_hash`, `network`, `provider`, `created_at`, `updated_at`.
>    - `offramp_status_events` — append-only, `(id, session_id,
>      source ["webhook"|"poll"|"reconciler"], carret_status,
>      mapped_status, payload_jsonb, received_at)`.
> 2. **Reconciler upgrade** — the existing `orphanReconciler.ts` reads
>    from those tables, calls Carret's `GET /offramp/orders/` for any
>    session that has been in a non-terminal state longer than 90s,
>    and writes a `reconciler` event + updates the session row when
>    the states disagree.
> 3. **Recovery demo** — we'll kill the process mid-flight (after
>    place_order, before the webhook lands), let the reconciler catch
>    up on next startup, and produce screenshots + a jq'd DB dump of:
>    - the initial `place_order` row,
>    - the missed webhook event that never arrived,
>    - the reconciler event that closed the loop,
>    - the settlement_batch_id link.
>
> Effort: ~1 day. We'll share the demo capture in the same reply as
> D4.2's tx hashes.

**Code work implied:** the three items above are the deliverable. New
files:
- `backend/src/db/client.ts` — add the two `CREATE TABLE` blocks in
  the schema init.
- `backend/src/services/offrampStore.ts` — thin CRUD for both tables
  so `offramp.ts` and the reconciler share one code path.
- `backend/src/services/orphanReconciler.ts` — swap the query to hit
  `offramp_sessions`, add a Carret order-status call, write an event
  row per reconcile.
- `backend/src/routes/index.ts` — the webhook handler writes an event
  row alongside the mutation.
- One-line change in `offramp.ts` to make `settlementBatchId`
  required on the API (schema + client).

Effort: ~1 day eng, split into 2 PRs (persistence first, reconciler
demo second).

---

### D4.4 — Redacted Carret order record

**Answer we should give:** once D4.3 lands, we'll ship a
`docs/samples/d4-carret-order-sample.json` with:

- Amount (USDC + INR sides),
- Final Carret status (`filled` / `partially_filled`),
- Order created / updated / filled timestamps,
- Our `session.id`,
- Our `settlement_batch_id`,
- Redacted: driver name, bank account number (last-4 only), driver
  email hashed.

Format we'll use:

```json
{
  "pathpulse_session_id": "off_2026_09_20_ab12cd",
  "settlement_batch_id":  "stl_2026_09_20_1a2b3c",
  "carret_order_id":      "1099",
  "amount":               { "usdc": "10.00", "inr": "839.20" },
  "status":               "filled",
  "timestamps": {
    "placed_at":   "2026-09-20T14:12:03Z",
    "filled_at":   "2026-09-20T14:14:38Z",
    "webhook_at":  "2026-09-20T14:14:41Z"
  },
  "bank": {
    "bank_name":  "HDFC Bank",
    "last4":      "0421",
    "status":     "verified"
  },
  "stellar_tx_hash":     "abcd…1234",
  "horizon_url":         "https://stellar.expert/explorer/public/tx/abcd…1234"
}
```

**Code work implied:** none beyond D4.2 + D4.3. We can generate the
sample from the DB rows once the reconciler demo runs.

---

## D5 — Stellar Broker

**The honest state.** `backend/src/routing/stellarbroker-provider.ts`
implements `quote` but `execute` throws:

```
throw routingError(
  'StellarBroker execution is not wired yet — needs an interactive
   session (partnerKey + confirmQuote/mediator flow)',
  501, 'ExecutorMissing'
);
```

Aquarius (`aquarius-provider.ts`) can quote and execute. On any real
swap today the aggregator picks Aquarius because Broker's
`canExecute: false` disqualifies it (see
`aggregator.ts:rankQuotes` / test at
`aggregator.test.ts:150`).

**Answer we should give — pick one of the two paths and commit:**

> **Option A (preferred):** modify D5 so **Aquarius is the testnet
> execution venue** and Stellar Broker is a quote source only. The
> "each acting as a fallback" wording in `docs/TESTNET_EVIDENCE.md`
> (D5 section) is corrected to: *"Aquarius executes on testnet. Stellar
> Broker is used as an additional quote source and price-competition
> signal; execution through Broker requires their partner-key +
> mediator flow which we'll wire in Tranche 3 once mainnet is live."*
> The aggregator ranking test at
> `backend/src/routing/aggregator.test.ts:148` already validates this
> exact behavior.
>
> **Option B (only if you want us to execute one Broker swap):** we
> can request a StellarBroker partner key + implement their
> confirmQuote / mediator handshake in
> `stellarbroker-provider.ts:execute`. Effort ~2 days once we have the
> partner key, blocked on Broker onboarding. Given T2 is graded on
> execution existing at all, Option A is a cleaner close.

**Code work implied (Option A):**
- Edit `docs/TESTNET_EVIDENCE.md` D5 section — replace "each acting
  as a fallback" with the wording above.
- No source-code change; the aggregator already prefers Aquarius when
  Broker `canExecute=false`.

Effort: ~30 min doc edit.

---

## D6 — PulseGen → SCOUT → settlement multiplier

**The honest state.** `backend/src/services/pulsegen.ts` has
`pulseGenLive` gated on `env.pulseGen.baseUrl && env.pulseGen.apiKey`,
neither of which is set. `scoreProvider()` returns
`syntheticScoreProvider` — the caller supplies the score and it's
recorded with `source: 'synthetic'` so nothing masquerades as a real
PulseGen result.

**Answer we should give:**

> The T2 evidence for D6 was captured with `syntheticScoreProvider` —
> that's flagged in `ValidationScore.source: "synthetic"` on every
> assignment we've stored. For T2 close, we can either:
>
> **Option A:** stand up a real PulseGen adapter against a partner API
> (partner integration is not yet contracted — target Tranche 3), and
> in the meantime share the synthetic-source path as the pipeline
> proof, calling it out as synthetic.
>
> **Option B:** substitute a driver-observability feed we already have
> (per-driver GPS honesty + trip completion rate from the driver app
> event stream) as the *first* `ScoreProvider` implementation
> alongside `synthetic`. It uses the same interface (`ScoreProvider`
> in `services/pulsegen.ts`), records itself with a distinct
> `ScoreSource` value (`live` = true), and produces a real 0..1 score
> for every driver we already have events for. We then run the
> pipeline end-to-end using one such driver:
>
> 1. adapter returns a real score for driver `<addr>`,
> 2. `POST /v1/scout/assign` uses that score → SCOUT tier grant tx,
> 3. next settlement batch reads the tier via `getOnchainTier` and
>    applies the tier multiplier to the driver's `driverRewards`
>    slice.
>
> We'll share the three tx hashes (score capture → tier grant →
> settlement) in the follow-up.

**Code work implied (Option B):**
- New `backend/src/services/pulsegen/observabilityAdapter.ts`
  implementing `ScoreProvider` from whatever event data we have (even
  a simple `completedTrips / totalTrips` is defensible).
- New `ScoreSource` value in `@pathpulse/contract`.
- Wire selection in `scoreProvider()` behind an env flag so we can
  toggle back to synthetic for demos.
- Capture script that runs the three-step chain and prints the tx
  hashes.

Effort: ~1 day if event data is already queryable.

**Ask the user (Aditya):** which option? A is easier to send today, B
lands us a real feed and closes D6 cleanly.

---

## Accounts

The mainnet treasury is `GCESVOGE2FLAWTV6D2BQ7H3KRRJT5D74IXWEGR7MZQUJK2MNMBD5MIA3`: master weight 0,
thresholds 2/2/2, three signers at weight 1, each created by a different signatory in their own wallet
(set_options tx `678113af8c0f6256a4f1b37d6c692d62cb30300c2159318d1549f2d2ff1d6ffd`). Every signer pair has
signed a test payment; the evidence log is in `docs/TREASURY_CEREMONY.md`. `GET /v1/treasury/config` returns
the same configuration live, read from Horizon.

---

## Order of operations before we send this reply

1. **Decide** the two open questions:
   - D6 Option A or B?
2. **Ship** the D4.3 persistence + reconciler PR (~1 day). This must
   land before the next capture run — the answer to D4.2 depends on
   it.
3. **Cutover to mainnet** for the Carret path (flip the two env vars,
   check treasury USDC balance).
4. **Capture** three real end-to-end orders, save the JSON sample
   (D4.4), record the reconciler recovery demo (D4.3).
5. **Doc edits**: D5 wording fix in `TESTNET_EVIDENCE.md`, D4
   modification note added to `docs/production-launch.md`.
6. **Send** the reply — paste the sections above with the captures +
   tx hashes filled in.

Estimate: ~2 days engineering + Ops mainnet funding + Stellar review
turnaround.
