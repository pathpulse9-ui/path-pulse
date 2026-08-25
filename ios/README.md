# PathPulse — iOS app (Swift / SwiftUI)

**Owner:** Daiwik · **Phase 1 (D1) scope** · built after Android, mirroring its IA

Thin client over the Backend Core API (`../backend`), behaviorally identical to Android.
There is **no on-device crypto and no embedded wallet** — Privy was substituted, so the
email/OAuth account is platform-managed (custodial) and the backend signs on its behalf.
See `../docs/CUSTODY.md`. Everything comes from the backend API in
`../packages/contract/openapi.yaml`.

## Phase 1 tasks
- [ ] SwiftUI app scaffold mirroring the Android information architecture
- [ ] ~~Privy iOS SDK onboarding flow~~ **SUBSTITUTED** — sign in against `POST /v1/auth/google/verify`
- [ ] Keychain-backed session storage
- [ ] Wire the delegated path (`POST /v1/tx/build` → `POST /v1/tx/submit`) against the local backend

## API contract
Generate Swift models from `../packages/contract/openapi.yaml`
(e.g. Apple's swift-openapi-generator). Keep generated code separate from hand-written UI.

## Local backend
```bash
# from repo root
npm run dev:backend   # http://localhost:8080
```
The iOS simulator reaches the host backend directly at `http://localhost:8080`.
