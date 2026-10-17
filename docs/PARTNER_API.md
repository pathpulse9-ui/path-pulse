# PathPulse Partner API

Read-only access to settlement data for government and institutional partners. Everything here is
the same data the `/gov` dashboard shows, served to a partner's own systems.

## Keys

An operator issues one key per partner organisation:

```bash
POST /v1/ops/partner-keys        {"name": "Ministry of Transport"}   → 201 {"key": "pp_…", "record": {…}}
GET  /v1/ops/partner-keys                                            → {"items": [{id, name, createdAt, revokedAt, lastUsedAt}]}
DELETE /v1/ops/partner-keys/:id                                      → 204 (revoked immediately)
```

The `key` is shown once and never stored — only its SHA-256 hash is kept. Hand it to the partner
over a secure channel. Revoking stops it on the next request.

Partners send it as a bearer token:

```bash
curl -H "Authorization: Bearer pp_<id>_<secret>" https://<api-host>/v1/settlement/batches?limit=20
```

Limits: 300 requests per minute per key. A revoked or malformed key gets `401`.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/settlement/batches` | Settlement batches, newest first. Filters: `network`, `assetCode`, `since`, `until`, `minAmount`, `maxAmount`, `cursor`, `limit` (≤100). Partners see full driver ids. |
| GET | `/v1/settlement/batches/:id` | One batch: deposit, conversion, split, driver payouts, payout batch id |
| GET | `/v1/ops/payouts/batches/:id` | The SDP payout batch for a settlement: per-driver status and Stellar tx hash |
| GET | `/v1/gov/ledger` | Every indexed payment into or out of the protocol accounts, linked to its batch. Filters: `account`, `cursor`, `limit` (≤200) |
| GET | `/v1/settlement/batches/export.csv` | One row per batch (same filters as the list) |
| GET | `/v1/settlement/batches/payouts.csv` | One row per driver payout, with treasury deposit and settlement hashes |
| GET | `/v1/settlement/batches/:id/receipt.pdf` | Printable receipt for one batch |
| GET | `/v1/accounts/distribution` | The three distribution accounts |
| GET | `/v1/treasury/config` | Treasury signers and thresholds |

## Tracing one payout end to end

1. `GET /v1/settlement/batches/:id` → `deposit.txHash` (treasury → settlement source) and `txHash` (the 50/30/20 split).
2. On mainnet the driver pool is the SDP distribution account, so `GET /v1/ops/payouts/batches/:payoutBatchId`
   → `receipts[].stellarTxHash` are payments out of that same 30% leg.
3. `GET /v1/gov/ledger?account=<driver pool>` lists those payments independently, straight from the chain index.

Every hash can be checked on Horizon or stellar.expert without trusting PathPulse.
