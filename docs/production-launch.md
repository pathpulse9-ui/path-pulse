# Production Launch Runbook

Everything that has to flip to move the driver flow from **sandbox demo** to
**real payouts hitting real bank accounts**. Grouped by owner + roughly in
the order they should happen.

Owners:
- **Eng** — I can do these end-to-end today.
- **Ops** — needs infra access (AWS root, KMS, funded treasury).
- **Biz** — needs Carret / Google contracts.

---

## 1. Carret sandbox → production `[Biz + Eng]`

### Ask Carret for prod credentials

Send Carret this exact message:

> Hi team, we're ready to move PathPulse to production. Please share:
> 1. Our **production API key** for `prod.carret.in`
> 2. The **production account_id** we should point at (either promote our
>    dev sub-account `48559` or issue a fresh prod one — whichever is your
>    standard path)
> 3. Confirmation that **prod webhook signature** uses the same scheme as
>    dev (we set `CARRET_WEBHOOK_SECRET` per environment)
> 4. Any prod-specific minimums / limits that differ from dev

### Flip backend env on App Runner

```
CARRET_BASE_URL=https://prod.carret.in/api/v1/taas
CARRET_API_KEY=<the new prod key>
CARRET_ACCOUNT_ID=<the prod account id>
CARRET_ALLOW_TESTNET=false      # or remove entirely
CARRET_BANK_ID=                  # empty — drivers must register their own now
```

Then `make deploy-api` — Makefile's `ENV_ALLOW` already covers all of these.

### Verify

```bash
curl -s -X POST https://demo-api.pathpulse.ai/v1/auth/guest -H "Content-Type: application/json" -d '{}'
# then POST /v1/carret/kyc/initiate on a test account → should hit prod.carret.in
```

Should see prod URL in the backend Carret logs.

---

## 2. Stellar testnet → mainnet `[Ops + Eng]`

### AWS KMS-backed signer

Backend refuses mainnet with `SIGNER_BACKEND=dev` — that's the mainnet
safety gate. Ops has to:

1. Create a KMS **asymmetric key** (`ECC_SECG_P256K1`, sign+verify).
2. Grant App Runner's task role `kms:Sign` + `kms:GetPublicKey` on that key.
3. Fund the resulting Stellar address with XLM (base reserves + fees) and
   with USDC (Circle-issued mainnet asset:
   `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).

### Flip backend env

```
STELLAR_NETWORK=mainnet
STELLAR_MAINNET_ALLOW=true
SIGNER_BACKEND=aws-kms
KMS_KEY_ID=arn:aws:kms:us-east-1:691650376162:key/<uuid>
HORIZON_URL=https://horizon.stellar.org
FRIENDBOT_URL=                    # empty — mainnet has no friendbot
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### Verify

```bash
curl -s https://demo-api.pathpulse.ai/health
# → { "network": "mainnet", ... }
```

Every Stellar tx now signs through KMS, is submitted to mainnet Horizon,
and can be looked up on stellar.expert.

---

## 3. Publish Google OAuth consent screen `[Eng]`

Google Cloud Console → APIs & Services → OAuth consent screen →
**Publish App** button. Because we only ask for `openid email profile`
scopes, no review is required — status flips from `Testing` to
`In production` instantly.

Effect: any Google account can sign in (not just test-user allowlist).

---

## 4. iOS + Android bank UI parity `[Eng]`

Web shipped in commit `<latest bank commit>`. Mobile hasn't yet.

For iOS:
- new sheet `BankRegistrationSheet` shown from `OffRampView` when
  `resumeCarretKyc()` returns verified + `listCarretBanks()` returns empty
- reuse the same three fields (IFSC / a/c / holder / bank name)
- fields go into a new `Config` state, POST to `/v1/carret/banks`
- polling `listCarretBanks` on the sheet's `.onAppear` for the penny-drop
- once verified, unlock the withdrawal sheet

For Android:
- same pattern, Compose sheet triggered from the OffRamp tab
- Kotlin data class for the request, ktor call to `/v1/carret/banks`

Effort: ~1 hr per platform.

---

## 5. Hyperverge for Aadhaar XML `[Biz + Eng]`

Blocked on Carret sharing their Hyperverge sub-account credentials — see
`docs/google-signin-handoff.md` for the same pattern. Once received:

- backend routes `POST /v1/carret/kyc/digilocker/start` and
  `POST /v1/carret/kyc/digilocker/complete`
- iOS opens `SFSafariViewController` at the returned hosted URL
- on OAuth callback (universal link), poll `complete` → forwards
  XML to Carret `/kyc/document_file/submit/`

Effort: ~1.5 hrs.

---

## 6. Nice-to-haves for a polished v1 `[Eng]`

- **Trading-wallet balance chip** on the off-ramp page (`GET /wallet/?
  account_id=…` → "9.00 USDC available"). Saves the "why can't I
  withdraw 10" round-trip.
- **On-ramp** (INR → USDC): `/dashboard/onramp` mirrors off-ramp.
  Backend routes + Carret /onramp/quote/ + /onramp/place_order/.
  Effort: ~45 min.
- **Deposit-address panel** on the off-ramp page: shows the driver's
  Stellar deposit address + memo so they can top up their balance from
  an external wallet without asking Ops.
- **Order-history filters** (open / filled / cancelled) on the
  session list.
- **Signed-out landing page** — the current app assumes signed in.

---

## Order I'd recommend

1. Publish OAuth (30s, unblocks external testers).
2. Carret prod key request → email their team (async, ~1 business day).
3. Ship iOS + Android bank UI parity today (~2 hrs eng).
4. Ops sets up KMS + funds mainnet treasury (~half day parallel).
5. Backend env flip once (2) and (4) both land.
6. On-ramp UI + balance chip (nice-to-have polish).

Estimated total: **~4-6 hrs of eng + ~1 business day waiting on Carret**.
