# PathPulse — Custody & Key Management

> Status as of 2026-08-27, testnet. This document describes what is **actually running**,
> not what is planned. Where something is aspirational it says so.

## Summary

| | Path A — wallet connect | Path B — Google email/OAuth |
|---|---|---|
| Custody | **Self-custody** (user's) | **Custodial** (PathPulse holds the key) |
| Key location | User's browser extension | Sealed in Postgres (AES-256-GCM) |
| Who signs | The user, in their wallet | The backend, on the user's behalf |
| User can export key | Yes — it is theirs | **No** |
| User can recover | Yes — their wallet's seed | **No** |
| Survives a redeploy | Yes | Yes — sealed seed is persisted |
| Auth | SEP-10 challenge → httpOnly cookie | Google ID token → httpOnly cookie |

Platform-managed keys are **not** self-custody. Path B is custody and PathPulse holds it.

## Privy: substituted, not deferred

Privy was the original design — email/OAuth → non-custodial embedded Stellar wallet on
web, Android and iOS. It is **not integrated in any branch**: no SDK, no API call, no
credential. It has been formally substituted by the two paths above.

Path A is extension-based and therefore web-only; Path B covers email/OAuth sign-up on any
surface.

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

**No KMS or HSM is in service in any environment.**

What the dev signer signs for is the platform's own **service accounts** — settlement
(`stellar/settlement.ts`), group payout (`stellar/groupPayout.ts`), SCOUT issuance
(`stellar/scout.ts`) and AMM routing (`routing/swap.ts`) — plus Path B managed user
accounts via the delegated path.

`GET /v1/treasury/config` has **no signer behind it**. It is a read-through to Horizon and
holds no key.

## Where managed keys are stored

Path B seeds are sealed with **AES-256-GCM** under a 32-byte `KEY_ENCRYPTION_KEY` and stored
in Postgres (`managed_wallets`), one row per user. The stored format is
`v1.base64(iv‖tag‖ciphertext)` with a fresh 12-byte IV per seal, so the same seed never
produces the same ciphertext and any tampering fails the GCM auth check on unseal. Rows carry
the network they were created on and are refused if `STELLAR_NETWORK` no longer matches.

The database is managed **Postgres**, reached over TLS with `sslmode=verify-full`. The
connection string and the encryption key live in `.env`, which is gitignored and has never
been committed.

The account a seed belongs to is resolved through a `users` table mapping email to user id,
so a returning sign-in recovers the existing wallet rather than minting a new one. Both tables
are required: persisting seeds alone would keep the key safe and still lose the pointer to it.

This replaces the previous in-memory `Map`, under which every redeploy orphaned all managed
accounts permanently. **App Runner must still be pinned to one instance** — settlement
batches, group payouts, payout batches, off-ramp sessions and wallet-auth users all remain in
process memory. Key durability no longer requires the pin; those do.

## The delegated path

`POST /v1/tx/build` builds a transaction from the caller's managed account and signs it
backend-side; `POST /v1/tx/submit` relays a signed envelope to Horizon.

`/v1/tx/build` **requires a session** and derives the signing identity from it. Any
`userId` in the request body is ignored.

`/v1/tx/submit` is intentionally not session-gated: it relays an already-signed envelope,
which anyone can submit to Horizon directly, so it confers no privilege.

## Known limitations — read before trusting this with value

1. **Seeds decrypt into application memory to sign.** The seed is unsealed inside
   `stellar/managed.ts` only long enough to build a `Keypair`. Encryption-at-rest protects
   a leaked database dump; it does not protect against compromise of the running process.
2. **The key-encryption key is an env var.** `KEY_ENCRYPTION_KEY` sits beside the
   application, not in a KMS or HSM, so the root of trust is the environment. Losing it
   makes every stored seed permanently unrecoverable — back it up with the database.
3. **No KMS/HSM.** See above.
4. **Treasury secrets are file-held.** The replacement treasury's signer secrets live in
   `secrets/treasury-v2.json` (gitignored, mode 0600) on one machine, not in a managed
   secret store. That file is a single point of failure.

## Treasury accounts

### Original treasury — FROZEN, do not plan against it

`GADPEI5OQHNMU5KZ4WBC4QK5N6OQSEZJQLRF5X2NIVHL74KVLWGREN4M`

Thresholds 2/2/2 with four signers at weight 1 — **master key included**, so it is
**2-of-4, not 2-of-3**. On Stellar the master key is itself a signer, so the three
configured keys (`TREASURY_SIGNER_{1,2,3}_PUBLIC`) plus the master give four.
`buildTreasuryMultisigTx` now sets `masterWeight: 0`.


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
