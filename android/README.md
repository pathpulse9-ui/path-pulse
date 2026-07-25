# PathPulse — Android app (Kotlin / Jetpack Compose)

**Owner:** Daiwik · **Phase 1 (D1) scope**

Thin client over the Backend Core API (`../backend`). No Stellar signing logic lives here
except the Privy embedded wallet (the driver's own key). All balances, payouts, settlement
and SCOUT data come from the backend REST/WebSocket API defined in `../packages/contract/openapi.yaml`.

## Phase 1 tasks
- [ ] Jetpack Compose app scaffold, design system, networking layer (Retrofit/Ktor)
- [ ] Privy Android SDK onboarding: email/OAuth sign-up → embedded Stellar wallet
- [ ] Encrypted local storage (EncryptedSharedPreferences) + session management
- [ ] Wire `POST /v1/onboard` against the local backend

## API contract
Generate Kotlin models from the OpenAPI spec:
```
../packages/contract/openapi.yaml
```
(e.g. openapi-generator `kotlin` client). Keep generated code out of hand-edits so the
three clients stay in sync with the backend.

## Local backend
```bash
# from repo root
npm run dev:backend   # http://localhost:8080
```
On the Android emulator, reach the host backend at `http://10.0.2.2:8080`.
