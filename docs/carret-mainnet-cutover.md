# Carret → Mainnet cutover runbook

Everything that has to flip the moment the Carret team hands over the
production API key (expected Monday). Follow in order; each step is
reversible until step 5.

---

## 0. What you need from Carret

Reply to the thread once they confirm. Fill the three blanks below as
soon as you have them:

- [ ] Production `CARRET_API_KEY` — paste into AWS Secrets Manager (never
      in `.env` or chat).
- [ ] Production `CARRET_ACCOUNT_ID` — the integer sub-account they
      provision for `aditya.singh456m@gmail.com` (or whichever production
      email you nominate). This replaces the dev `48581`.
- [ ] Confirmation that their webhook signature uses the same HMAC-SHA256
      scheme we assumed in dev (same `CARRET_WEBHOOK_SECRET` shape).

Carret also needs from us:

- The Stellar address we'll deposit from (our mainnet Treasury or the
  per-driver managed wallet addresses). They allowlist it.
- A static egress IP from the backend — Carret IP-filters cloud traffic.
  App Runner NAT already gives us one; just hand it over.

---

## 1. Confirm mainnet-safe code is live

Every piece below is already in `main`; this is a verification step, not
a build step.

- [x] `backend/src/services/offramp.ts:carretLiveProvider.start` now
      broadcasts the Stellar USDC payment to Carret's deposit address
      (with their memo) whenever `STELLAR_NETWORK=mainnet` and the
      driver has a managed wallet. Transaction hash is persisted on
      `off_ramp_sessions.stellar_tx_hash` so every order carries a
      Horizon-verifiable link to the on-chain leg.
- [x] `backend/src/services/offramp.ts` refuses to run Carret on
      testnet unless `CARRET_ALLOW_TESTNET=true` is set (dev-only
      escape hatch — not allowed in prod per env guard).
- [x] `backend/src/config/env.ts` guard rejects boot on mainnet with
      `SIGNER_BACKEND=dev` or missing `KMS_KEY_ID`.
- [x] `broadcastCarretDeposit` uses Circle's issuer by default
      (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`);
      overridable via `CARRET_USDC_ISSUER`.

---

## 2. Fund the mainnet treasury

Before any production off-ramp can fill, the driver's managed wallet
needs USDC. For the first smoke-test driver that's probably the Treasury
seeding the managed wallet, not real driver earnings.

- [ ] Treasury account has ≥ 100 USDC (Circle, mainnet).
- [ ] Treasury account has ≥ 5 XLM for reserves + fees.
- [ ] Each managed wallet that will off-ramp has the USDC trustline open
      (`changeTrust`) and is seeded with ≥ 1 USDC for the test order.

Verify on `stellar.expert/explorer/public/account/<addr>` before step 4.

---

## 3. Flip the backend env on App Runner

Paste into `.env` (or your Secrets Manager equivalent) and redeploy:

```
STELLAR_NETWORK=mainnet
STELLAR_MAINNET_ALLOW=true
HORIZON_URL=https://horizon.stellar.org
FRIENDBOT_URL=
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

SIGNER_BACKEND=aws-kms
KMS_KEY_ID=arn:aws:kms:us-east-1:…/<treasury-key>

OFFRAMP_PROVIDER=carret
CARRET_BASE_URL=https://prod.carret.in/api/v1/taas
CARRET_API_KEY=<new prod key>
CARRET_ACCOUNT_ID=<new prod account>
CARRET_WEBHOOK_SECRET=<new prod secret>
CARRET_ALLOW_TESTNET=false
CARRET_BANK_ID=                    # empty — drivers must register their own
CARRET_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN

# Optional but strongly recommended before cutover
SENTRY_DSN=https://…@o…ingest.sentry.io/…
SENTRY_ENVIRONMENT=production
```

Then: `make deploy-api`. The `ENV_ALLOW` list already covers every
variable above.

---

## 4. Smoke-test one real order

With the deployed backend:

1. Sign in on `demo.pathpulse.ai` with a driver whose managed wallet is
   funded (step 2).
2. Register a real bank — Carret runs the ₹1 penny-drop live. Wait for
   `verified`.
3. Place a 1 USDC off-ramp with a real settlement batch id.
4. Confirm all four events land in order on
   `/v1/offramp/sessions/<id>/events`:
   - `create` → `pending_user_transfer_start`
   - `webhook` → `pending_anchor` (Carret saw our deposit)
   - `webhook` → `completed` (Carret filled the order)
5. Check `stellar.expert/explorer/public/tx/<stellarTxHash>` loads and
   shows a USDC payment from the driver's address to Carret's deposit
   address.
6. Check the destination bank actually received the INR (ask the test
   driver).

If step 5 is missing — the Stellar leg didn't fire. Check backend logs
for the `"carret deposit broadcast failed"` warning (now a Sentry event
too) and address before placing more orders.

---

## 5. Lock in

- [ ] Rotate `CARRET_ALLOW_TESTNET` out of every environment that
      touches real money.
- [ ] Add a monitor on `pathpulse-demo-api` for Sentry error-rate +
      Horizon submit-failure rate.
- [ ] Mark the mainnet transition in the T2 submission with the three
      smoke-test hashes.
