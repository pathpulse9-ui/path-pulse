# PathPulse D2 — Wallet Interoperability (Stellar Wallets Kit)

Deliverable 2 of the PathPulse 15-Day Settlement Sprint (Linear CUB-6).

A testnet demo where reviewers connect an external Stellar wallet via
[Stellar Wallets Kit](https://stellarwalletskit.dev) and execute a payment
signed by that wallet.

## What it covers

- **Wallet connectors** — `allowAllModules()` exposes Freighter, LOBSTR, xBull,
  Albedo, Rabet, Hana, Klever, and HOT Wallet through the kit's modal, with
  per-wallet availability detection (extensions not installed show "Not available").
- **Authentication flow** — connect → `getAddress()` → session established.
- **Transaction signing** — a 1 XLM testnet payment is built with
  `@stellar/stellar-sdk`, handed to the connected wallet as XDR via
  `kit.signTransaction()`, and the signed XDR is submitted to Horizon.
- **Session management** — the selected wallet + address persist in
  `localStorage` and are restored on reload; disconnect clears the session.

## Run the demo

```bash
npm install
npm run dev        # http://localhost:5173
```

1. Click **Connect wallet** and pick your wallet (Freighter on testnet is the
   easiest reviewer path).
2. If the account isn't funded, click **Fund via Friendbot**.
3. Click **Sign & submit 1 XLM payment** — approve in the wallet. The resulting
   hash links to stellar.expert for public verification.

## Headless verification

`npm run test:testnet` runs the same build → sign XDR → `fromXDR` → submit
pipeline the UI uses, with a local keypair standing in for the wallet signer,
against the live testnet. Useful for CI where no wallet extension exists.

## Notes

- Network is hard-pinned to **TESTNET** (`WalletNetwork.TESTNET`,
  `Networks.TESTNET`); no mainnet path exists in this deliverable.
- `vite.config.ts` defines `global: 'globalThis'` because the kit's HOT Wallet
  module pulls in NEAR/Node-flavored deps that reference `global`.
