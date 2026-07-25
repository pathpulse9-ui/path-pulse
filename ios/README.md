# PathPulse — iOS app (Swift / SwiftUI)

**Owner:** Daiwik · **Phase 1 (D1) scope** · built after Android, mirroring its IA

Thin client over the Backend Core API (`../backend`), behaviorally identical to Android.
The only on-device crypto is the Privy embedded wallet (the driver's own key). Everything
else comes from the backend API in `../packages/contract/openapi.yaml`.

## Phase 1 tasks
- [ ] SwiftUI app scaffold mirroring the Android information architecture
- [ ] Privy iOS SDK onboarding flow (email/OAuth → embedded Stellar wallet)
- [ ] Keychain-backed session storage
- [ ] Wire `POST /v1/onboard` against the local backend

## API contract
Generate Swift models from `../packages/contract/openapi.yaml`
(e.g. Apple's swift-openapi-generator). Keep generated code separate from hand-written UI.

## Local backend
```bash
# from repo root
npm run dev:backend   # http://localhost:8080
```
The iOS simulator reaches the host backend directly at `http://localhost:8080`.
