# PathPulse — Backend Core

Node.js / TypeScript · `@stellar/stellar-sdk` · Express · (Postgres + Redis in later phases).
The single server that owns all Stellar/settlement logic. Clients are thin — see
`../docs/ARCHITECTURE.md`.

## Run
```bash
# from repo root, install all workspaces once
npm install

# copy env and fill testnet values
cp .env.example .env

# start the API (testnet)
npm run dev:backend      # http://localhost:8080
```

## Phase 1 endpoints (D1)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness + network info |
| GET | `/v1/accounts/distribution` | Partner Revenue / Driver Pool / Treasury accounts |
| GET | `/v1/treasury/config` | multisig signer set + thresholds (testnet) |
| POST | `/v1/onboard` | Privy token → managed Stellar wallet |

## Provision testnet accounts
```bash
cd backend
npm run provision:testnet   # generates + friendbot-funds the 3 distribution accounts
```
Copy the printed `*_PUBLIC` keys into `.env`; store the secret keys in your secret manager.

## Human-gated boundaries
- **Treasury multisig** is *built* by the backend (`buildTreasuryMultisigTx`) but signed by a
  human signatory — never auto-applied.
- **Mainnet signing** requires a KMS/HSM signer backend; the `dev` signer refuses mainnet.
