# PathPulse — AWS Cost Estimate & Private-Key Storage Strategy

> **Status note (2026-08-25).** This is a forward-looking cost model, not a description of
> what runs today. **Privy is not integrated and is not planned** — it appears below only as
> one unselected option in a vendor comparison. No KMS, HSM or Vault backend is in service
> either. **Updated 2026-08-27:** AWS KMS signs Ed25519 natively (since Nov 2025); an `aws-kms`
> signer backend is **implemented and verified on testnet** but not yet in service, and driver
> seeds are encrypted at rest rather than held in memory. §1's Ed25519 analysis has been
> corrected. See `docs/KMS_VERIFICATION.md`.

> Status: planning estimate · Region assumed **ap-south-1 (Mumbai)** · Prices are
> **on-demand list** in USD/month and are **estimates for budgeting**, not quotes.
> Validate against the [AWS Pricing Calculator](https://calculator.aws) before committing.
> Reserved Instances / Savings Plans cut compute + DB by **30–55%**.

User tiers analysed: **50k**, **500k**, **1,000k (1M)** users.

---

## 1. What actually holds a private key in this system

The settlement system is server-side (see [ARCHITECTURE.md](ARCHITECTURE.md)). Keys fall into
two very different buckets:

**The only thing that scales with users is the driver-wallet bucket.** Everything else is a
fixed, small set.

### Ed25519 on KMS — resolved 2026-08-27

Stellar uses **Ed25519**. Since 7 Nov 2025 AWS KMS supports it directly via key spec
`ECC_NIST_EDWARDS25519`. Two signing algorithms exist on such a key and they are **not**
interchangeable:

- `ED25519_SHA_512` with `MessageType: RAW` — PureEdDSA per RFC 8032. **This is what Stellar
  needs.**
- `ED25519_PH_SHA_512` with `MessageType: DIGEST` — pre-hashed; produces signatures Stellar
  rejects.

Consequences, updated:

- You **can** hand a transaction hash to KMS and receive a Stellar-valid signature. The private
  key never enters application memory. Verified end-to-end on testnet — see
  `docs/KMS_VERIFICATION.md`.
- KMS's second role remains **encrypt-at-rest** for per-user seeds: `Encrypt` / `Decrypt` a
  32-byte seed, decrypted into memory only at signing. This applies to driver wallets, where
  per-key pricing ($1/key/month) makes one KMS key per user untenable.

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

**Combined AWS total (base infra + key management):**
Heavy settlement + SDP means you should not rely on public SDF Horizon in production.

| Option | 50k | 500k | 1M |
|--------|-----|------|----|
| Self-host Horizon + Captive Core (EC2 + Postgres + storage) | +$500 | +$1,200 | +$2,500 |
| Managed RPC/Horizon provider | variable (often comparable; less ops) | | |

### 2d. Driver-wallet custody (this dominates at scale — usually NOT on the AWS bill)

| Option | 50k active | 500k active | 1M active | Nature |
|--------|-----------|-------------|-----------|--------|
| **Self-custody envelope (KMS)** | ~$0 marginal | ~$0 marginal | ~$0 marginal | No per-wallet fee; cost already in the KMS line + trivial Postgres storage. |

> Privy numbers are order-of-magnitude and based on per-active-wallet list pricing — **active**,
> not total, wallets, and enterprise deals differ. Treat as "this can rival your entire AWS bill,
> so model it explicitly." Self-custody removes the fee but you now own the security + liability.

---

## 3. Private-key storage options compared

| Option | Ed25519? | Key isolation | ~Cost @ 1M | Ops burden | Best for |
|--------|:--------:|---------------|-----------|-----------|----------|
| **KMS envelope encryption** | encrypt (per-user seeds) | Seed in app memory at sign time | ~$60/mo | Very low | Driver keys at any scale. | 
| **KMS Ed25519 signing** | ✅ sign (`ECC_NIST_EDWARDS25519`) | Never leaves KMS | ~$1/key/mo | Very low | Protocol + treasury accounts. Verified on testnet. | 
| ~~old row~~ | | | | | multisig. |
| **AWS CloudHSM** | ✅ sign | Never leaves HSM (FIPS L3) | ~$2,400/mo flat | High | Treasury / compliance-grade custody. |
| **HashiCorp Vault (Transit)** | ✅ sign | Never leaves Vault | ~$150–300/mo | Medium-high | Ed25519 signing without CloudHSM cost, if you'll run Vault well. |
| **MPC / custody SaaS** (Privy, Turnkey, DFNS, Fireblocks, Fordefi, Web3Auth) | ✅ | Sharded / provider-held | per-wallet or enterprise | Low (offloaded) | Fast launch, offloaded liability; watch per-MAW fees. |
| **AWS Secrets Manager** | n/a (storage only) | Encrypted at rest | $0.40/secret/mo | Low | The ~10 fixed service secrets — **never** per-user. |
| **Hardware wallets / offline cold signers** | ✅ sign | Air-gapped | hardware only | Manual | Treasury multisig co-signers / key ceremony. |
---


## 4. Assumptions & how to validate

- Region **ap-south-1**; on-demand list prices; USD. us-east-1 is ~10–15% cheaper.
- Active-user ratio assumed ~10% DAU; your real ratio moves compute/DB/Redis materially.
- Excludes: dev/staging environments (add ~30–40%), WAF/Shield, SES/SNS, support plan.
- Reserved Instances / Compute Savings Plans (1yr, no upfront) cut compute + RDS + Redis **30–55%**
  — apply once traffic is steady; this is the biggest lever, far bigger than KMS-vs-no-KMS.
- Rebuild these numbers in the [AWS Pricing Calculator](https://calculator.aws) with real instance
  sizes before signing off. Get a written **enterprise quote from Privy** for your active-wallet
  projection — that single number likely decides the custody architecture.
