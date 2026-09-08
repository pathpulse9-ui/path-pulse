# PathPulse — Mainnet cutover checklist

> Phase 5 (Days 56–65) of the 75-day plan. Human-gated by design: **no
> mainnet transaction is constructed or signed without explicit sign-off**.

The backend enforces this via `assertMainnetAllowed()` in
[`backend/src/stellar/networkGuard.ts`](../backend/src/stellar/networkGuard.ts).
When `STELLAR_NETWORK=mainnet` is set, every settlement submit, transaction
submit, and (in follow-up work) SDP disbursement / off-ramp order will
refuse with `MainnetGateClosed (403)` unless `STELLAR_MAINNET_ALLOW=true`
is *also* set. The flag is deliberately separate from the network variable
so a mainnet-configured deploy can't slip into mainnet operation without a
second human step.

## Pre-cutover (Phase 4, Days 41–55)

- [ ] Treasury key ceremony scheduled — three signatories named, quorum date locked
- [ ] AWS KMS production key created and signer public key recorded (`SIGNER_BACKEND=aws-kms`, `KMS_KEY_ID=<arn>`)
- [ ] SCOUT Classic Assets minted on **testnet** end-to-end (D6 evidence already covers this)
- [ ] Aquarius routing dry-run passed on testnet (D5 evidence covers this)
- [ ] Carret production tenant contract signed; production `CARRET_BASE_URL`, `CARRET_API_KEY`, `CARRET_ACCOUNT_ID`, `CARRET_BANK_ID`, `CARRET_WEBHOOK_SECRET` provisioned into the deploy's secret store (not committed)
- [ ] SDP mainnet tenant provisioned; `SDP_BASE_URL`, `SDP_API_KEY`, `SDP_WALLET_ID`, `SDP_ASSET_ID` updated for mainnet
- [ ] Monitoring + alerting operational (Sentry DSN configured — PAT-73)
- [ ] iOS release build submitted to App Store; Android release build submitted to Play Store

## Cutover (day-of)

- [ ] Treasury key ceremony — three signatories in one room / secure call. Master weight set to 0, three signers to weight 1 each on the mainnet treasury account (`TREASURY_PUBLIC` = mainnet). Reuse [`POST /v1/treasury/multisig/build`](../backend/src/routes/index.ts) to build the XDR; sign it via Stellar Laboratory + hardware wallets.
- [ ] Distribution accounts (`PARTNER_REVENUE_PUBLIC`, `DRIVER_POOL_PUBLIC`, `TREASURY_PUBLIC`) funded on mainnet — no Friendbot exists there, funding is manual
- [ ] SCOUT issuer account provisioned on mainnet; SCOUT1/SCOUT2/SCOUT3 assets issued with `AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED`
- [ ] Update deploy env:
  - `STELLAR_NETWORK=mainnet`
  - `HORIZON_URL=https://horizon.stellar.org`
  - `SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org` (Aquarius routing)
  - `AQUA_ROUTER_CONTRACT=<mainnet router>`
  - All Carret / SDP secrets swapped to production values
- [ ] **STELLAR_MAINNET_ALLOW is still `false` at this point** — the guard blocks any accidental transaction
- [ ] Manual smoke: `GET /health`, `GET /v1/treasury/config`, `GET /v1/accounts/distribution` all return mainnet public keys; `POST /v1/settlement/batches` refuses with `MainnetGateClosed`
- [ ] Second sign-off: set `STELLAR_MAINNET_ALLOW=true` on the deploy
- [ ] **Pilot batch** — one settlement of ≤ $10 total gross, three drivers, review the on-chain 3-op split, confirm SDP fan-out delivers, confirm Carret withdraw simulation completes
- [ ] Roll public dashboards to point at mainnet Horizon

## Post-cutover

- [ ] Add `STELLAR_NETWORK`, `HORIZON_URL`, `network` label to on-call runbooks
- [ ] Wire alert: any `MainnetGateClosed` error → page on-call (means someone tried a mainnet op after flag was later set back to false)
- [ ] Rotate treasury signer keys quarterly per key-rotation policy

## Rollback

If a pilot batch behaves unexpectedly:
1. Set `STELLAR_MAINNET_ALLOW=false` on the deploy → all further submits refuse immediately
2. Freeze any in-flight settlement via the treasury multisig (2-of-3 signers can pause)
3. Restore testnet configuration from the last known good deploy manifest
4. File incident, capture Horizon tx hashes, notify Umair + treasury signers
