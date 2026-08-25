# PathPulse — AWS Cost Estimate & Private-Key Storage Strategy

> **Status note (2026-08-25).** This is a forward-looking cost model, not a description of
> what runs today. **Privy is not integrated and is not planned** — it appears below only as
> one unselected option in a vendor comparison. No KMS, HSM or Vault backend is in service
> either; the live signer is the in-memory dev tier. See `docs/CUSTODY.md` for actual state.

> Status: planning estimate · Region assumed **ap-south-1 (Mumbai)** · Prices are
> **on-demand list** in USD/month and are **estimates for budgeting**, not quotes.
> Validate against the [AWS Pricing Calculator](https://calculator.aws) before committing.
> Reserved Instances / Savings Plans cut compute + DB by **30–55%**.

User tiers analysed: **50k**, **500k**, **1,000k (1M)** users.

---

## TL;DR (read this first)

1. **"With KMS vs without KMS" is a rounding error** on the AWS bill — under ~$250/mo
   difference at *every* tier. Do not make the architecture decision on that line item.
2. **Never store per-user keys as individual KMS keys.** KMS is **~$1 per key per month**.
   At 1M users that is **~$1,000,000/month**. This is the single most expensive mistake
   available and it must be designed out.
3. **AWS KMS cannot sign Stellar (Ed25519) keys.** KMS asymmetric signing supports RSA and
   NIST/secp ECC only — **not Ed25519**. So KMS is used for **envelope encryption** of the
   Ed25519 seed, not for signing. CloudHSM and HashiCorp Vault *do* support Ed25519 signing.
4. **Two key tiers, two strategies:**
   - **Treasury / protocol keys** (a handful, control real funds) → multisig with signers on
     **CloudHSM or KMS-envelope + hardware/offline co-signers**.
   - **Driver wallets** (scales to millions) → today these are **custodial, backend-held and
     in-memory** (prototype tier, see `docs/CUSTODY.md`). The two candidate destinations are a
     managed vendor such as Privy (non-custodial, off your books) or **KMS envelope encryption
     self-custody**; the break-even between them is §5. Neither is adopted yet.
5. **Most cost-effective key mechanism: AWS KMS envelope encryption.** One (or a few) symmetric
   KMS keys encrypt every Ed25519 seed; ciphertext lives in Postgres. Marginal cost at 1M users
   is **pennies**, versus per-user KMS keys ($1M/mo) or per-active-wallet SaaS fees.

---

## 1. What actually holds a private key in this system

The settlement system is server-side (see [ARCHITECTURE.md](ARCHITECTURE.md)). Keys fall into
two very different buckets:

| Key | Count | Value at risk | Where it should live |
|-----|-------|---------------|----------------------|
| PathPulse Treasury (multisig master + signers) | ~3–6, fixed | **Very high** (all funds) | CloudHSM, or KMS-envelope + hardware co-signers |
| Partner Revenue / Driver Pool distribution accounts | 2–3, fixed | High | Same as treasury |
| Driver managed wallets (Ed25519 seed per driver) | **= user count** | Low–medium each | Privy (managed) **or** KMS envelope self-custody |
| Service/API secrets (SDP, Carret/Ramp, DB, SEP-10 signing) | ~10, fixed | Medium | AWS Secrets Manager |

**The only thing that scales with users is the driver-wallet bucket.** Everything else is a
fixed, small set. That is why per-user KMS keys are wrong and envelope encryption is right.

### The Ed25519 caveat (important)

Stellar uses **Ed25519**. AWS KMS asymmetric keys support `RSA_*`, `ECC_NIST_P256/384/521`,
and `ECC_SECG_P256K1` for sign/verify — **Ed25519 is not on the list**. Consequences:

- You **cannot** hand a Stellar secret to KMS and ask KMS to sign a transaction.
- KMS's role for Stellar is **encrypt-at-rest**: `GenerateDataKey` / `Encrypt` / `Decrypt` the
  32-byte seed. The seed is decrypted into app memory only for the moment of signing, then zeroed.
- If you want the key to **never touch application memory**, you need **CloudHSM** (PKCS#11 EdDSA
  on current firmware) or **HashiCorp Vault Transit** (supports `ed25519` sign), not KMS.

---

## 2. AWS monthly cost estimate

### 2a. Base infrastructure (shared by all key strategies)

Assumes ~10% of users are daily-active, autoscaled Fargate, Multi-AZ RDS + Redis. Excludes
key management, Stellar/Horizon access, and driver-wallet custody (all itemised separately below).

| Line item | 50k users | 500k users | 1M users |
|-----------|-----------|------------|----------|
| Compute — Fargate app + WS/indexer workers | $250 | $700 | $1,400 |
| RDS PostgreSQL (Multi-AZ, + read replicas at scale) | $400 | $1,150 | $3,000 |
| ElastiCache Redis (primary + replica/cluster) | $290 | $700 | $1,600 |
| Application Load Balancer | $30 | $80 | $150 |
| NAT Gateway + data transfer/egress | $120 | $500 | $1,200 |
| CloudWatch (metrics, logs, alarms) | $60 | $200 | $500 |
| S3 (backups, compliance exports) | $25 | $80 | $200 |
| **Base infra subtotal** | **~$1,175** | **~$3,410** | **~$8,050** |

### 2b. Key management: WITH KMS vs WITHOUT KMS

This is the direct answer to the question. "Without KMS" here means doing encryption-at-rest
some other way — self-hosting **HashiCorp Vault** (HA) on EC2 instead of using the managed KMS.

| Approach | 50k | 500k | 1M | Notes |
|----------|-----|------|----|-------|
| **KMS (envelope)** — a few symmetric keys + Decrypt/GenerateDataKey calls | **+$30** | **+$45** | **+$60** | Keys ~$1/mo each; API $0.03/10k requests. Negligible even at 1M. |
| **Without KMS** — self-host Vault HA (2× t3.medium + EBS + your ops) | +$140 | +$180 | +$260 | Cheaper mechanism *on paper* only if you ignore engineering/on-call cost. Also supports Ed25519 signing. |
| **CloudHSM option** (2× hsm1.medium, HA) | +$2,400 | +$2,400 | +$2,400 | Flat, user-independent. FIPS 140-2 L3, Ed25519 signing, keys never leave HSM. |

**Combined AWS total (base infra + key management):**

| Scenario | 50k | 500k | 1M |
|----------|-----|------|----|
| **WITH KMS (envelope)** ✅ recommended | **~$1,205** | **~$3,455** | **~$8,110** |
| **WITHOUT KMS (self-host Vault)** | ~$1,315 | ~$3,590 | ~$8,310 |
| **WITH CloudHSM (treasury-grade)** | ~$3,575 | ~$5,810 | ~$10,450 |

**Takeaway:** KMS is both the **cheapest** and the **least operational** option for
encryption-at-rest. "Without KMS" saves nothing — it costs more once you count Vault's EC2 +
patching + on-call. CloudHSM is not about user scale; it is a flat ~$2.4k/mo security upgrade
you buy for the treasury tier when compliance or funds-at-risk justify it.

### 2c. Stellar / Horizon access (add-on, pick one)

Heavy settlement + SDP means you should not rely on public SDF Horizon in production.

| Option | 50k | 500k | 1M |
|--------|-----|------|----|
| Self-host Horizon + Captive Core (EC2 + Postgres + storage) | +$500 | +$1,200 | +$2,500 |
| Managed RPC/Horizon provider | variable (often comparable; less ops) | | |

### 2d. Driver-wallet custody (this dominates at scale — usually NOT on the AWS bill)

| Option | 50k active | 500k active | 1M active | Nature |
|--------|-----------|-------------|-----------|--------|
| **Privy** (managed, non-custodial embedded wallets) | ~$1k–2.5k | ~$10k–25k | ~$25k–50k | Per **monthly-active-wallet** beyond free tier; enterprise pricing negotiable. |
| **Self-custody envelope (KMS)** | ~$0 marginal | ~$0 marginal | ~$0 marginal | No per-wallet fee; cost already in the KMS line + trivial Postgres storage. |

> Privy numbers are order-of-magnitude and based on per-active-wallet list pricing — **active**,
> not total, wallets, and enterprise deals differ. Treat as "this can rival your entire AWS bill,
> so model it explicitly." Self-custody removes the fee but you now own the security + liability.

---

## 3. Private-key storage options compared

| Option | Ed25519? | Key isolation | ~Cost @ 1M | Ops burden | Best for |
|--------|:--------:|---------------|-----------|-----------|----------|
| **KMS envelope encryption** | via encrypt (not sign) | Seed in app memory at sign time | ~$60/mo | Very low | Default. Driver keys at any scale; treasury if paired with multisig. |
| **AWS CloudHSM** | ✅ sign | Never leaves HSM (FIPS L3) | ~$2,400/mo flat | High | Treasury / compliance-grade custody. |
| **HashiCorp Vault (Transit)** | ✅ sign | Never leaves Vault | ~$150–300/mo | Medium-high | Ed25519 signing without CloudHSM cost, if you'll run Vault well. |
| **MPC / custody SaaS** (Privy, Turnkey, DFNS, Fireblocks, Fordefi, Web3Auth) | ✅ | Sharded / provider-held | per-wallet or enterprise | Low (offloaded) | Fast launch, offloaded liability; watch per-MAW fees. |
| **AWS Secrets Manager** | n/a (storage only) | Encrypted at rest | $0.40/secret/mo | Low | The ~10 fixed service secrets — **never** per-user. |
| **Hardware wallets / offline cold signers** | ✅ sign | Air-gapped | hardware only | Manual | Treasury multisig co-signers / key ceremony. |

Per-user KMS **keys** (one CMK per driver) are deliberately omitted — at $1/key/mo they are
$50k / $500k / $1M per month respectively. Do not do this.

---

## 4. Recommendation by scale

**All tiers — core mechanism: KMS envelope encryption.** One KMS CMK (or one per tier) wraps a
data key; the Ed25519 seed is stored AES-encrypted in Postgres; decrypt only in memory at sign
time behind the existing `Signer` interface ([backend/src/stellar/signing.ts](../backend/src/stellar/signing.ts)).

- **50k users (~$1.2k/mo AWS + Horizon).** KMS envelope for everything. Adopt **Privy** for driver
  wallets (cheap here, offloads security while you harden). Treasury: KMS-envelope signer + 2
  hardware co-signers for the 2/3 multisig — avoids the CloudHSM floor. **Skip CloudHSM.**
- **500k users (~$3.5k/mo AWS + Horizon).** Same core. Re-evaluate Privy: at ~$10k–25k/mo it may
  now exceed your entire AWS spend — start the self-custody envelope migration for driver wallets.
  Consider CloudHSM for the treasury tier if audit/compliance requires FIPS L3.
- **1M users (~$8k/mo AWS + Horizon).** Driver wallets should be **self-custody envelope** (Privy
  per-MAW is $25k–50k/mo). Treasury on **CloudHSM** (the ~$2.4k/mo is now a small fraction of spend
  and worth the isolation). Add RDS read replicas, Redis cluster, self-hosted Horizon.

---

## 5. Break-even: Privy vs self-custody envelope

Privy costs ~per active wallet; self-custody envelope is ~flat. Rough monthly comparison of the
**driver-key line only**:

| Active wallets | Privy (approx) | Self-custody envelope | Cheaper |
|----------------|----------------|-----------------------|---------|
| 50k | ~$1k–2.5k | ~$0 marginal | self-custody on $, Privy on risk/liability |
| 200k | ~$4k–10k | ~$0 marginal | self-custody |
| 500k+ | ~$10k–25k+ | ~$0 marginal | self-custody, clearly |

Privy still buys you: no custody liability, recovery flows, social/email login, and speed. The
right call is **Privy first, migrate the moment its monthly fee exceeds the cost of building +
running the envelope path** (roughly the low-hundreds-of-thousands of active wallets), and keep
the `Signer` interface so the swap is contained to the backend.

---

## 6. Assumptions & how to validate

- Region **ap-south-1**; on-demand list prices; USD. us-east-1 is ~10–15% cheaper.
- Active-user ratio assumed ~10% DAU; your real ratio moves compute/DB/Redis materially.
- Excludes: dev/staging environments (add ~30–40%), WAF/Shield, SES/SNS, support plan.
- Reserved Instances / Compute Savings Plans (1yr, no upfront) cut compute + RDS + Redis **30–55%**
  — apply once traffic is steady; this is the biggest lever, far bigger than KMS-vs-no-KMS.
- Rebuild these numbers in the [AWS Pricing Calculator](https://calculator.aws) with real instance
  sizes before signing off. Get a written **enterprise quote from Privy** for your active-wallet
  projection — that single number likely decides the custody architecture.

---

## 7. Security non-negotiables (independent of cost)

- Treasury/mainnet keys stay **human-gated** — no mainnet signature is auto-produced (already
  enforced: the dev signer refuses mainnet in [signing.ts](../backend/src/stellar/signing.ts)).
- Treasury is **multisig ≥ 2/3** with signers on **separate custody** (don't put all signers in one
  KMS/HSM — that defeats multisig). Ideal: 1 HSM/KMS + 2 hardware, geographically/administratively split.
- Envelope model: decrypt seed only in memory, zeroize after signing, never log it, per-key IAM
  least-privilege, CloudTrail on every KMS Decrypt, alarms on anomalous decrypt volume.
- Secrets Manager for service secrets with rotation; never in `.env` on mainnet.
```

**Cost figures are budgeting estimates — validate in the AWS Pricing Calculator before committing.**
