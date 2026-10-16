# PathPulse mainnet AWS infrastructure

What's live in AWS for the mainnet backend, so this doesn't live only in
one person's shell history.

Last provisioned: 2026-10-14. Region: `us-east-1`. Account: `691650376162`.

---

## App Runner service

```
Service   pathpulse-demo-api
ARN       arn:aws:apprunner:us-east-1:691650376162:service/pathpulse-demo-api/
          36dfb0f85c7a424f92726291399a79a9
URL       https://demo-api.pathpulse.ai
Image     ECR 691650376162.dkr.ecr.us-east-1.amazonaws.com/pathpulse-backend
Role      arn:aws:iam::691650376162:role/PathPulseAppRunnerInstance
Egress    VPC (via connector below) — static Elastic IP 3.220.133.103
```

Env vars are not here — they live inside App Runner's RuntimeEnvironmentVariables.
Sync them from local `.env` with `make env` (vars listed in `ENV_ALLOW` only).

---

## VPC + NAT for static egress

Carret IP-whitelists partner traffic. App Runner's default egress rotates
through an AWS NAT pool, so partners can't allowlist us. The VPC egress
below pins outbound to one Elastic IP.

```
VPC             vpc-0fd140f0f651f80ff   10.100.0.0/16
Public  1a      subnet-097c6638a4e70906f   10.100.0.0/24
Private 1a      subnet-0c99db8b163291ba5   10.100.10.0/24
Private 1b      subnet-0577f649c39b26a2e   10.100.11.0/24
IGW             igw-09b271695a6f6574f
NAT GW          nat-0badb95e87dded7e8     (in public-1a)
Elastic IP      3.220.133.103             (eipalloc-06cfbd3da467ab473)
Public RT       rtb-00f549222c5b18dd3     (0.0.0.0/0 → IGW)
Private RT      rtb-0d2c804923c627f3e     (0.0.0.0/0 → NAT)
Security Group  sg-05b13d041ea7892dc      (outbound-only)
VPC Connector   arn:aws:apprunner:us-east-1:…/vpcconnector/pathpulse-vpc-connector/
                1/9052e6db3f8b4da3b066dcaade03941d
```

Every resource is tagged `app=pathpulse` so cost-tracking + cleanup are easy.

Monthly cost: ~$33 (NAT Gateway + Elastic IP + modest data transfer).

### Partners that must whitelist 3.220.133.103

- **Carret** (`prod.carret.in`) — Anurag whitelisted 2026-10-14.

Add new partners here as they come online.

### To hand a different IP later

Allocate a new Elastic IP, swap it onto the NAT Gateway via
`aws ec2 associate-address`. The current NAT keeps running; only the public
IP changes. Then tell partners to re-whitelist.

---

## KMS keys

Two distinct keys — do not reuse one for both purposes.

```
Treasury signer     arn:aws:kms:us-east-1:691650376162:key/
                    bdf81ab2-d5dd-4be0-ac6b-f95b46d4f1d1
                    SIGN_VERIFY, ECC_NIST_P256.
                    Backs the Stellar treasury signer.
                    .env: KMS_KEY_ID=...

Data KEK            arn:aws:kms:us-east-1:691650376162:key/
                    c9bf4f53-66df-4429-955b-2a69f328853f
                    ENCRYPT_DECRYPT, SYMMETRIC_DEFAULT.
                    alias/pathpulse-kek
                    Wraps the per-driver seed-encryption key stored in
                    managed_wallets.sealed_seed.
                    .env: KEY_ENCRYPTION_KEY_CIPHERTEXT=<base64 ciphertext>
```

App Runner's `PathPulseAppRunnerInstance` role has:
- `kms:Sign`, `kms:Verify`, `kms:GetPublicKey` on the treasury signer
- `kms:Decrypt`, `kms:DescribeKey` on the data KEK (inline policy
  `allow-kek-decrypt`)

### If the data KEK is lost

Every `managed_wallets.sealed_seed` row becomes undecryptable → every
driver's funds are stranded. Back up the key policy + ciphertext in
1Password / Vault, enable KMS key rotation, never delete the key.

---

## Hosted Stellar Disbursement Platform

All resources are tagged `app=pathpulse` in `us-east-1`, inside the existing VPC.

| Resource | Name / ID |
|---|---|
| EC2 host | `pathpulse-mainnet-sdp`, t3.small, private IP `10.100.10.18`, no public IP |
| RDS Postgres 14 | `pathpulse-mainnet-sdp-db`, db.t4g.micro, encrypted, private, deletion protection, 7-day backups |
| Security groups | `sg-0e9c93d1d226b0c5b` (host, port 8000 from the App Runner connector SG), `sg-0ffee4f4d5b139c92` (DB, 5432 from the host SG) |
| IAM | role and instance profile `pathpulse-mainnet-sdp-role` |
| Secrets Manager | `pathpulse-mainnet-sdp/env` |
| CloudWatch logs | `pathpulse-mainnet-sdp`, 30-day retention |

The host runs `stellar/stellar-disbursement-platform-backend:6.6.1` through Docker Compose in `/opt/sdp`. Access is through SSM Session Manager only.

The backend reaches it at `SDP_BASE_URL=http://10.100.10.18:8000`. `DRIVER_POOL_PUBLIC` must be the tenant's distribution account, not the host account.

## Daily operations

| Task | Command |
|------|---------|
| Push env changes from `.env` to the live service | `make env` |
| Deploy a new backend image | `make deploy-api` |
| See current egress IP | `curl -sS https://demo-api.pathpulse.ai/v1/ops/egress-ip` |
| Check mainnet health | `curl -sS https://demo-api.pathpulse.ai/health` |
| See what's happening to a session | `curl -sS "https://demo-api.pathpulse.ai/v1/offramp/sessions/<id>/events"` |

---

## Mainnet env toggles that live in `.env` (never in git)

Full set — if a disaster forces a full rebuild from scratch, these are
what makes the service mainnet-safe:

```
STELLAR_NETWORK=mainnet
STELLAR_MAINNET_ALLOW=true
HORIZON_URL=https://horizon.stellar.org
FRIENDBOT_URL=
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

SIGNER_BACKEND=aws-kms
KMS_KEY_ID=<treasury signer ARN>
KEY_ENCRYPTION_KEY_CIPHERTEXT=<base64 of KMS-encrypted 32-byte key>

ACCOUNT_FUNDING=sponsor
SESSION_SECRET=<64 hex chars>
OPS_PASSCODE=<24 base64 chars>
PATHPULSE_INTERNAL_SCORER=true

CARRET_BASE_URL=https://prod.carret.in/api/v1/taas
CARRET_API_KEY=<prod>
CARRET_ACCOUNT_ID=<prod>
CARRET_WEBHOOK_SECRET=<prod>
CARRET_ALLOW_TESTNET=false
CARRET_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

Changing any of these needs `make env` to take effect.
