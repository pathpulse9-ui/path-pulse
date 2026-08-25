# PathPulse — Custody & Key Management

> Status as of 2026-08-25, testnet. This document describes what is **actually running**,
> not what is planned. Where something is aspirational it says so.

## Summary

| | Path A — wallet connect | Path B — Google email/OAuth |
|---|---|---|
| Custody | **Self-custody** (user's) | **Custodial** (PathPulse holds the key) |
| Key location | User's browser extension | Backend process memory |
| Who signs | The user, in their wallet | The backend, on the user's behalf |
| User can export key | Yes — it is theirs | **No** |
| User can recover | Yes — their wallet's seed | **No** |
| Survives a redeploy | Yes | **No — key is lost permanently** |
| Auth | SEP-10 challenge → httpOnly cookie | Google ID token → httpOnly cookie |

Platform-managed keys are **not** self-custody. Path B is custody and PathPulse holds it.

## Privy: substituted, not deferred

Privy was the original design — email/OAuth → non-custodial embedded Stellar wallet on
web, Android and iOS. It is **not integrated in any branch**: no SDK, no API call, no
credential. It has been formally substituted by the two paths above.

The substitution is a **custody downgrade**. Privy's embedded wallets are non-custodial by
construction; Path B, which replaced that flow, is not. Path A is genuinely non-custodial
but requires a browser extension, so it does not cover the mobile onboarding case Privy was
chosen for. That gap is real and unclosed.

Privy still appears in `docs/AWS_COST_AND_KEY_STORAGE.md` as one option in a comparison of
managed-custody vendors. That is an unselected option in a cost model, not a commitment.

## Signer backends

`SIGNER_BACKEND` selects the implementation (`backend/src/stellar/signing.ts`).

| Backend | Status |
|---|---|
| `dev` | **Live.** `DevSigner` — ed25519 secrets in process memory, never written to disk, regenerated on restart. Refuses to construct when `STELLAR_NETWORK=mainnet`. |
| `aws-kms` | Declared, **not implemented** — throws. |
| `gcp-kms` | Declared, **not implemented** — throws. |
| `hsm` | Declared, **not implemented** — throws. |

**No KMS or HSM is in service in any environment.** The only real hardening today is
negative: the dev signer will not produce a mainnet signature at all.

What the dev signer signs for is the platform's own **service accounts** — settlement
(`stellar/settlement.ts`), group payout (`stellar/groupPayout.ts`), SCOUT issuance
(`stellar/scout.ts`) and AMM routing (`routing/swap.ts`) — plus Path B managed user
accounts via the delegated path.

`GET /v1/treasury/config` has **no signer behind it**. It is a read-through to Horizon and
holds no key.

## The delegated path

`POST /v1/tx/build` builds a transaction from the caller's managed account and signs it
backend-side; `POST /v1/tx/submit` relays a signed envelope to Horizon.

`/v1/tx/build` **requires a session** and derives the signing identity from it. Any
`userId` in the request body is ignored. This was not always true — see the changelog entry
for 2026-08-25, where an unauthenticated caller who knew a user id could have the backend
sign from that user's wallet.

`/v1/tx/submit` is intentionally not session-gated: it relays an already-signed envelope,
which anyone can submit to Horizon directly, so it confers no privilege.

## Known limitations — read before trusting this with value

1. **Managed keys are in-memory only.** No database, no persistence. Every redeploy or
   restart orphans every managed account created before it and the funds become
   permanently unspendable. App Runner autoscaling is pinned to one instance for this
   reason. This is prototype-grade and must not front a real user.
2. **No KMS/HSM.** See above.
3. **Treasury secrets are file-held.** The replacement treasury's signer secrets live in
   `secrets/treasury-v2.json` (gitignored, mode 0600) on one machine, not in a managed
   secret store. That file is a single point of failure.

## Treasury accounts

### Original treasury — FROZEN, do not plan against it

`GADPEI5OQHNMU5KZ4WBC4QK5N6OQSEZJQLRF5X2NIVHL74KVLWGREN4M`

Thresholds 2/2/2 with four signers at weight 1 — **master key included**, so it is
**2-of-4, not 2-of-3**. The three non-master secrets exist nowhere: the provisioning script
printed them to stdout and never persisted them.

**Root cause.** `buildTreasuryMultisigTx` hardcoded `masterWeight: 1`. Three signer keys are
configured (`TREASURY_SIGNER_{1,2,3}_PUBLIC`), so the count read as 2-of-3 — but on Stellar
the master key is itself a signer, making it 4. At weight 1 against a threshold of 2 the
master could authorize nothing alone, so it provided **no** lockout recovery while widening
the scheme to any-2-of-4. Had it been weight 0 the account would still be frozen but honest;
had it been ≥ 2 the lost signer secrets would not have mattered. Fixed to `masterWeight: 0`.

Master alone is weight 1 against a threshold of 2, so it can authorize neither a payment
**nor a `set_options` to repair its own signer set**. The account is permanently frozen.
Its only transaction is the configuring
`96e0090852c6c0d2f5806a8657f92752b3133d11e52d717dad9fe3db27097dcd`, whose fourth operation
sets `master_key_weight: 1` alongside the 2/2/2 thresholds — the whole of the 2-of-3 /
2-of-4 discrepancy, visible on-chain.

### Replacement treasury — live, a genuine 2-of-3

`GBRXUTNCZOM7NX6N3RC5YJAPGNAJENCKJTBXMWQKOFHGAY4FCHDO7QT2`

Master key at **weight 0**, three signers at weight 1, thresholds 2/2/2 — total signing
weight 3 against a threshold of 2. Provisioned by `backend/scripts/provision-treasury-v2.ts`,
which writes the secrets to disk rather than printing them.

- config tx `9f93fc82ac8e6a1268fd470cb8c58175d123d6f5112065cabcb047622eb30856`
- two-signer proof `4face5e7ffaa2c77bf9477a8ba775b773c33ef24ff6c9114861d3d6c28a93722`

The running demo's distribution env vars still point at the **original** treasury.
Migrating them is outstanding work.

## Rules

- Never reintroduce app-side keypair generation for the non-custodial path. Path A is
  extension-based wallet connect; that is the established direction.
- Never describe Path B as self-custody, non-custodial, or "the user's own wallet".
- Never let a signer produce a mainnet signature without a human-gated KMS/HSM backend.
- Back up `secrets/treasury-v2.json` before it becomes load-bearing.
