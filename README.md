# PathPulse

Blockchain settlement infrastructure on the **Stellar network** — contributor reward &
institutional payout system (Deliverables D1–D8).

> One shared backend, three thin clients. The settlement system is server-side; the apps
> render it. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Monorepo layout
| Path | Stack | Owner |
|------|-------|-------|
| [`backend/`](backend) | Node/TS · `@stellar/stellar-sdk` · Postgres · Redis | Aaditya |
| [`web/`](web) | TypeScript · Vite/React · Stellar Wallets Kit | Aaditya |
| [`android/`](android) | Kotlin · Jetpack Compose · Privy | Daiwik |
| [`ios/`](ios) | Swift · SwiftUI · Privy | Daiwik |
| [`packages/contract/`](packages/contract) | OpenAPI + shared TS types (API source of truth) | shared |
| [`docs/`](docs) | architecture, phase plan, runbooks | shared |

## Quick start (backend + web)
```bash
npm install
cp .env.example .env      # fill testnet values
npm run dev:backend       # http://localhost:8080
npm run dev:web           # Vite dev server
```

## Plan & tracking
- 75-day roadmap and per-phase ownership: [`docs/PHASE_PLAN.md`](docs/PHASE_PLAN.md)
- Linear team `CUB`, issues CUB-5 (D1) → CUB-12 (D8); orchestrator protocol in `../PathPulse/CLAUDE.md`
- **Network policy:** testnet only through Phase 4; mainnet in Phases 5–6 behind human gates.
