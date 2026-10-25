# PathPulse — Mainnet treasury multisig ceremony

Goal: a mainnet treasury account that no single person, and not the backend, can spend from.
Target state, checked on the ledger at the end:

| Property | Required value |
|---|---|
| Master key weight | **0** |
| Signers | exactly **3**, weight 1 each, one per named signatory |
| Thresholds (low / medium / high) | **2 / 2 / 2** |
| Backend access | public keys only — no treasury secret ever reaches the backend, `.env.mainnet`, the repo or chat |

Why each rule exists:

- On Stellar the master key is itself a signer. Leaving it above weight 0 turns a 2-of-3 into a 2-of-4, so
  master weight 0 and a proof that every signer pair works come before real funds arrive.
- Each signatory generates their own key on their own device. Signer keys are never generated together in
  one process or kept in one file.
- The backend only ever builds unsigned transactions for the treasury (`buildTreasuryMultisigTx`,
  `buildTreasuryConversion`). It never signs them.

## Roles

| Role | Who | Holds |
|---|---|---|
| Signer 1, 2, 3 | three named people (write the names in the evidence log) | their own signing key, on a hardware wallet where possible |
| Ceremony lead | one of the signers | the treasury master key, **only until step 6** |
| Ops operator | someone on `OPS_OPERATORS` | an ops session, to call the build endpoint |
| Funder | you | sends mainnet funds from your own wallet (nobody else, no script) |

## Before you start

- [ ] Three signatories named and a date locked, all available for the whole session (about 1 hour).
- [ ] Each signatory has a way to sign Stellar transactions that keeps the secret off shared machines:
      a Ledger or other hardware wallet, or Freighter on their own device. Each has written down their
      recovery phrase on paper, stored separately from their device.
- [ ] A browser on the ceremony lead's machine open at <https://laboratory.stellar.org> with **Mainnet**
      selected (top right). Do not paste secrets into any other site.
- [ ] Decide where the signers' public keys and the evidence log live (a shared doc with public keys only).

## Step-by-step

### 1. Each signatory creates their own key and shares only the public key

Each signer, on their own device:

1. Create a new Stellar account in their wallet (or a new key in the hardware wallet).
2. Copy the **public key** (starts with `G`) and send it to the ceremony lead.
3. Do not send the secret or recovery phrase to anyone, ever.

Ceremony lead: check that the three public keys are different and that each is confirmed by its owner on
a call (read the first 6 and last 6 characters aloud). Record them as `SIGNER_1`, `SIGNER_2`, `SIGNER_3`.

> A signer key does not need to hold funds. It only signs. It does not need to exist on the ledger for the
> signing to work, but a signer who also wants to submit from their own wallet can fund it separately.

### 2. The ceremony lead creates the treasury (master) key

1. In Stellar Lab: **Account → Create Account → Generate keypair**. Do this with the network disconnected if
   practical, or in a private window on a machine nobody else uses.
2. Write the **secret key** on paper. Do not save it to a file, clipboard manager, password manager sync or chat.
3. Copy the **public key**. This is `TREASURY_PUBLIC`.

This secret is only needed once, in step 6. After that the account's master weight is 0 and the secret is
worthless — destroy the paper in step 8.

### 3. Fund the treasury account (you, by hand)

Stellar needs a minimum balance of 1 XLM, plus 0.5 XLM for each signer and 0.5 XLM for the USDC trustline
(about 3 XLM), plus fees. Fund with **5 XLM** first. Do not send USDC yet.

1. From your own wallet app, send 5 XLM to `TREASURY_PUBLIC`.
2. In Lab → **Account → Fetch account** (Mainnet) confirm the account exists with a 5 XLM balance.
3. Record the funding transaction hash in the evidence log.

### 4. Put the public keys into the backend config

In `.env.mainnet` (public keys only):

```
TREASURY_PUBLIC=<treasury public key>
TREASURY_SIGNER_1_PUBLIC=<signer 1 public key>
TREASURY_SIGNER_2_PUBLIC=<signer 2 public key>
TREASURY_SIGNER_3_PUBLIC=<signer 3 public key>
TREASURY_THRESHOLD_LOW=2
TREASURY_THRESHOLD_MED=2
TREASURY_THRESHOLD_HIGH=2
```

Redeploy the mainnet backend (`make deploy NETWORK=mainnet`). Leave `STELLAR_MAINNET_ALLOW=false`: building a
transaction does not submit anything, and the gate stays closed until the final sign-off.

### 5. Build the configuration transaction

1. Sign in to the web app as an operator and unlock ops (passcode).
2. Call `POST /v1/treasury/multisig/build` (ops only). The response is `{ "xdr": "<base64>" }`.
3. The transaction does three things in one atomic step: adds the three signers at weight 1, sets master
   weight to 0, and sets all three thresholds to 2. It either all applies or nothing does.

> **The XDR expires 5 minutes after it is built.** Have the master secret and Lab ready before you call the
> endpoint. If it expires, call the endpoint again.

Before signing, all three signers look at the decoded transaction in Lab → **Transaction → View XDR** and
check by eye:

- [ ] Source account = `TREASURY_PUBLIC`.
- [ ] Exactly three "Set Options → signer" operations, and the three keys are the ones each signer confirmed in step 1.
- [ ] A final Set Options with master weight 0 and thresholds 2 / 2 / 2.
- [ ] No other operations.

### 6. Sign with the master key and submit

1. Lab → **Transaction → Sign**. Paste the XDR, then sign with the treasury **master secret** (from the paper).
2. Lab → **Submit transaction** to Mainnet. Record the transaction hash.
3. Do this once only. If it fails, read the result codes before retrying (see "If something goes wrong").

### 7. Verify on the ledger

- [ ] Lab → **Account → Fetch account** on `TREASURY_PUBLIC`: signers are the 3 keys, each weight 1, the
      treasury's own key is **weight 0**, thresholds low / med / high are all 2.
- [ ] `GET /v1/treasury/config` on the deployed backend returns the same signers and thresholds. The endpoint
      reads them from Horizon when the account exists, so this checks the ledger, not the env file.
- [ ] `GET /v1/accounts/distribution` shows the treasury as multisig.

Do not move funds in yet.

### 8. Destroy the master secret

Master weight is 0, so the master secret can no longer sign anything. Destroy the paper (cross-cut shred
or burn) in front of the signers and record that it was done.

### 9. Prove every signer can sign — before real funds arrive

On mainnet, with only the 5 XLM in the account, run **three** small payments of 0.0000001 XLM to the driver pool
(`DRIVER_POOL_PUBLIC`), one for each pair of signers:

| Test | Signed by |
|---|---|
| A | signer 1 + signer 2 |
| B | signer 2 + signer 3 |
| C | signer 1 + signer 3 |

For each test:

1. Lab → **Build Transaction**, source = `TREASURY_PUBLIC`, fetch the sequence number, add a Payment operation,
   set a 5-minute time bound.
2. Signer X signs it (hardware wallet or Freighter), then passes the XDR to signer Y, who signs it.
3. Submit. Record the hash.

Also check the negative case once: a payment signed by **one** signer is rejected (`tx_bad_auth`).

If any pair fails, that signer's key does not work. Fix it now (step 10) while funds are still not at risk.

### 10. Add the USDC trustline (2 signers)

The treasury must hold USDC to pay the settlement source. With two signers, submit a Change Trust operation for
USDC issued by Circle (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). Cost: 0.5 XLM reserve.

### 11. Fund the treasury with USDC (you, by hand)

Send a small amount first (the pilot batch is at most $10 USDC), confirm it arrives, then more later.
Only now is the treasury ready for the pilot batch in `docs/MAINNET_CUTOVER.md`.

### 12. Treasury payments from now on

For every treasury payment (for example the pilot deposit to the settlement source):

1. Build the unsigned transaction (Lab, or `POST /v1/routing/treasury/conversions` for an asset conversion).
2. Two signers review it and sign.
3. Submit from Lab. Pass the resulting transaction hash to `POST /v1/settlement/batches` as `depositTxHash`.
   The backend only accepts a deposit paid by the treasury or the routing source.

## Evidence log (fill in as you go; public values only)

| Item | Value |
|---|---|
| Ceremony date | 2026-10-24 (mainnet) |
| Signer 1 / 2 / 3 (names) | Naved / Umair / Daiwik |
| `TREASURY_PUBLIC` | `GCESVOGE2FLAWTV6D2BQ7H3KRRJT5D74IXWEGR7MZQUJK2MNMBD5MIA3` |
| Signer public keys | `GCSB6O5GAL3GUUBA5VJAXZYISHVYA3EGZ3HDBRAE3DUI5ADUSPQLIIM3` (Naved), `GBMEJVBF43QQ372QEBEW6AVHMBM6DDH4Z6CATFAJOF7VNPHAELFFLIVU` (Umair), `GD325OSZQUOU5FMXXQKGXMIMO4E5CJUX6GZVVYSJPIVQLDHC7YI6FMIV` (Daiwik) — each created by its holder in their own wallet |
| Funding tx (5 XLM) | Not needed: the account already existed with master weight 0 and thresholds 2/2/2 |
| Configuration tx | `678113af8c0f6256a4f1b37d6c692d62cb30300c2159318d1549f2d2ff1d6ffd` (ledger 65107770): the three keys above at weight 1; master 0, thresholds 2/2/2 |
| Pair A / B / C tx | A Naved + Umair `31763e63fab07372b37a610488fa19de239663958f423934b70bfa755f7ead1a` (ledger 65108620) · B Umair + Daiwik `486ca341dc8c71623d95d7cb0834d6bea2d101a48af152980d05632e63a5193c` (ledger 65108676) · C Naved + Daiwik `27c3f966e9551c9d718c00eee8e5149f02df39dff8a96b54e6938177370f2156` (ledger 65108835; its memo reads "test B", it was built with the wrong label). Both signatures on each verified against the keys |
| Negative test (one signer, `tx_bad_auth`) | Rejected twice: Naved alone on test A, Daiwik alone on test B |
| `GET /v1/treasury/config` captured | 2026-10-24: the three keys above at weight 1, master 0, thresholds 2/2/2 |
| Master secret destroyed (who witnessed) | Not applicable: master weight is 0 |

Keep the completed log under `docs/evidence/` (local only) and reference the transaction hashes in
`docs/MAINNET_CUTOVER.md`.

## If something goes wrong

- **Submit fails with `tx_bad_auth`**: the master secret is wrong or the XDR was altered. Check the key matches
  `TREASURY_PUBLIC`. Nothing was applied.
- **Submit fails with `tx_too_late` / `tx_bad_seq`**: the XDR expired or the account changed. Build a new one.
- **A signer loses their key after setup**: the other two can still sign. Replace the lost signer immediately:
  both remaining signers sign a transaction that removes the old key (weight 0) and adds a new one. Do not
  wait — losing a second key freezes the account permanently.
- **Two keys lost**: the account is frozen. This is the situation the ceremony is designed to avoid. Funds
  cannot be recovered; start again with a new account and stop sending funds to the old one.
- **Wrong signer key added**: if master weight is not yet 0 (the config tx did not apply), nothing is lost.
  If it did apply, fix it with two valid signers by signing a signer-replacement transaction.

## Ongoing

- Rotate signer keys quarterly (two signers sign each rotation; always keep three valid signers).
- Re-check `GET /v1/treasury/config` monthly and after any signer change.
- Never put a treasury secret in `.env`, `.env.mainnet`, the repo, App Runner, Secrets Manager or chat.

## Decision still open

`docs/CUSTODY.md` records two options for the signer set: all three on KMS, or one KMS signer plus two human
signers. This runbook uses **three human signers** because it keeps a human gate and means the backend cannot
move treasury funds alone. If you choose a KMS signer instead, replace one `SIGNER_n` public key with the KMS
signer's public key in step 1 and add its signing path before step 9.
