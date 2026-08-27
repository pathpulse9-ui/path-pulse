# AWS KMS Ed25519 signing — verification record

## The setup, in short

PathPulse uses **AWS KMS** for Ed25519 signing. Protocol-owned Stellar accounts are signed by
asymmetric KMS keys with key spec `ECC_NIST_EDWARDS25519` and usage `SIGN_VERIFY`. Key material
is generated inside AWS's managed HSMs, is non-exportable, and never enters the application
process — the backend holds only a key ARN.

Signing proceeds in two steps. At construction the backend calls **`GetPublicKey`**, which
returns a 44-byte DER SubjectPublicKeyInfo; the trailing 32 bytes are the raw Ed25519 public
key, StrKey-encoded to yield the account's Stellar address. To sign, the backend computes the
32-byte Stellar transaction hash and calls **`Sign`** with `SigningAlgorithm: ED25519_SHA_512`
and `MessageType: RAW` — PureEdDSA per RFC 8032, which is precisely Stellar's signature scheme.
KMS returns a raw 64-byte signature, attached to the envelope as a `DecoratedSignature`.

Driver wallets are handled separately. KMS bills per key per month, so one key per user is
untenable at scale; driver seeds are instead encrypted at rest with AES-256-GCM and decrypted
in memory only at the moment of signing.

## What was verified

That a Stellar transaction can be signed by an Ed25519 private key held in AWS KMS, where the
key material never enters the application process, and that the resulting signature is
accepted by the Stellar network.

## Evidence

**On-chain transaction — signed entirely by KMS**

| | |
|---|---|
| Hash | `07dc33d4caa6a1a74c317c9c796c097c348baeaa7717e2595cb7ab0257d02cfb` |
| Explorer | <https://stellar.expert/explorer/testnet/tx/07dc33d4caa6a1a74c317c9c796c097c348baeaa7717e2595cb7ab0257d02cfb> |
| Source account | `GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS` |
| Memo | `kms-signed` |
| Ledger | 4358729 |
| Created | 2026-08-27T07:52:43Z |
| Signatures | 1 |
| Result | `successful: true` |

The source account's address is **derived from the KMS public key** — it has no seed and no
`Keypair` ever existed for it anywhere. The only way to produce that signature is a `Sign`
call to KMS.

**KMS key used**

| | |
|---|---|
| Alias | `alias/pathpulse-stellar-signer` |
| ARN | `arn:aws:kms:us-east-1:691650376162:key/bdf81ab2-d5dd-4be0-ac6b-f95b46d4f1d1` |
| KeySpec | `ECC_NIST_EDWARDS25519` |
| KeyUsage | `SIGN_VERIFY` |
| Signing algorithms offered | `ED25519_SHA_512`, `ED25519_PH_SHA_512` |
| Algorithm used | `ED25519_SHA_512` with `MessageType: RAW` |

## Step-by-step results

| Step | Result |
|---|---|
| `GetPublicKey` returns SPKI | 44 bytes, DER prefix `302a300506032b6570032100` (OID 1.3.101.112, id-Ed25519) |
| SPKI → Stellar address | `GAKYXUFDWZ6Q…`, valid strkey |
| Transaction hash to sign | 32 bytes |
| `Sign` returns | 64 raw bytes |
| `addSignature` accepts | 1 signature attached |
| Signature verifies against the derived address | ✅ |
| Hash stable across XDR round-trip | ✅ |
| Horizon submission | `successful: true` |

## Algorithm choice — this matters

AWS offers two Ed25519 signing algorithms and they are **not interchangeable**:

- `ED25519_SHA_512` requires `MessageType: RAW` — PureEdDSA per RFC 8032. **This is what
  Stellar needs.**
- `ED25519_PH_SHA_512` requires `MessageType: DIGEST` and pre-hashes the input. Using it
  produces signatures Stellar rejects.

The key spec is `ECC_NIST_EDWARDS25519`, not `ECC_ED25519`.

## Cost

- KMS key: **$1/month, prorated hourly** (~$0.0014/hour)
- Sign / Verify / GetPublicKey: **$0.03 per 10,000 requests**, no free tier for asymmetric keys

Per-key pricing is why this applies to the handful of service and treasury accounts and
**not** to driver wallets: one key per driver would be $1 per driver per month — $10,000/month
at 10,000 wallets. Driver seeds stay on encrypted-at-rest storage, whose cost is flat in
wallet count.

## Implementation

- `backend/src/stellar/kms.ts` — `AwsKmsSigner`, `addressFromSpki()`, `awsKmsClient()`
- `backend/src/stellar/kms.test.ts` — 9 tests against an injected fake that emulates the KMS
  wire format, so the crypto path is covered without AWS credentials
- `backend/src/stellar/signing.ts` — `createSigner()` selects it on `SIGNER_BACKEND=aws-kms`

## Status — what is and is not true

**Implemented and verified.** The signer works against real AWS KMS and the proof is a
permanent, publicly verifiable testnet transaction.

**In service for protocol accounts, as of 2026-08-27.** `SIGNER_BACKEND=aws-kms`, and the four
protocol service accounts — settlement, group payout, SCOUT issuer and AMM routing — each carry
`GAKYXUFDWZ6Q…` (the address derived from the KMS key) as an authorized signer. Their
transactions are signed by KMS; the key never enters the process.

**Not applied to driver wallets, by design.** Per-user KMS keys would cost $1 per driver per
month. Driver seeds stay encrypted at rest with AES-256-GCM and are decrypted in memory only at
signing time. `getManagedSigner` selects per tier: service accounts route through
`SIGNER_BACKEND`, per-user wallets always sign with their own sealed seed.

**To put it in service:** create a durable key, add its derived address as a signer on the
target Stellar account via `setOptions`, remove the old signer, and set `SIGNER_BACKEND=aws-kms`
with `KMS_KEY_ID`. The account id never changes, so nothing downstream moves.

**On HSMs.** AWS KMS keys are generated inside, and never leave, AWS-managed HSM hardware — the
application can request a signature but can never read the key. A separate CloudHSM or PKCS#11
backend is therefore not used: KMS provides the same hardware-backed guarantee for these key
counts at a small fraction of the cost.


## Migration — protocol accounts now sign through KMS

Performed 2026-08-27. The KMS-derived address `GAKYXUFDWZ6Q3FKIA7GCOGZVH5VBGMOLEGKNPZZGKJU36D3GPEM2TLSS`
was added as an authorized signer on each protocol service account via `setOptions`. Account ids
were unchanged, and each account's original signer was left in place, so there is no path by
which deleting the KMS key can strand an account.

| Service account | Stellar address |
|---|---|
| `__settlement_source__` | `GBQOGCRXI2MG5MDXP7QKROOR7X6PWNUOT3R2YSXNLFHPAO3YMBXWZJPC` |
| `__group_payout_source__` | `GBRAS4T5A3HGOYCN6TC6CZLOSUM5Y265MF6DXVSZNR3Z5LJHODC3K3O4` |
| `__scout_issuer__` | `GBKGCHRV3YOPTRUR6SDVL46GWWZNXQ6WGOSTVR46HLE5XQMOAS7P6SF4` |
| `__routing_swap_source__` | `GB2ATSCL5MS6TTT5TRUGXUP4AK2MRKUST5E6S6W7UO4XG2Y56BXVKCM7` |

**Proof of live KMS signing:** tx `3b73c013dc1f7e1cc7f0dd57b6642421db4e87ddfd11b99c838c10de69c70c47`
(ledger 4360517, memo `kms live`) — a payment from the settlement source account. The signature
hint matches the KMS key and verifies against `GAKYXUFDWZ6Q…`; the signature was produced by a
`Sign` call to KMS, with no key material in the application.

One KMS key serves all four accounts, so the cost is $1/month rather than $1 per account.
