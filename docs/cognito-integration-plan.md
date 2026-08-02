# AWS Cognito Integration Plan

*2026-08-01 — plan only; nothing has been implemented.*

## Where auth stands today

The backend is already Cognito-shaped: [`auth.ts`](../backend/src/auth.ts)
verifies tokens with `aws-jwt-verify` when `COGNITO_USER_POOL_ID` is set, takes
identity exclusively from the verified `sub` claim, and `GET /me` creates the
profile row on first call. Local development bypasses all of it via
`DEV_USER_ID`, which the server refuses to run with in production.

The mobile app has **no auth at all**: no sign-in screens, no token storage,
and `runSync()` expects a `getAccessToken` callback that nothing supplies yet.
That is where nearly all the new work lands.

## 1. User pool (one per environment: dev / staging / prod)

| Setting | Value | Why |
| --- | --- | --- |
| Sign-in | Email as username (case-insensitive alias) | The design's primary method |
| Verification | Auto-send email code on sign-up | Standard; blocks typo'd addresses |
| Required attributes | `email` only | Everything else lives in Postgres |
| Custom attributes | **None** | `research_consent`, display name etc. are app data — queried relationally, so they belong in the `users` table (already there), not in Cognito where they'd be invisible to SQL |
| MFA | Off for MVP | Casual-use app; revisit later |
| Account recovery | Email | |
| Deletion protection | On (prod only) | |

`users.id` mirrors the Cognito `sub`, as the schema already documents.

## 2. App client

| Setting | Value | Why |
| --- | --- | --- |
| Client type | Public, **no secret** | A mobile binary cannot keep a secret |
| Auth flow | `USER_SRP_AUTH` only | Password never transits in plaintext; do not enable `USER_PASSWORD_AUTH` or admin flows |
| Token validity | Access 1 h · ID 1 h · Refresh 30 d | Casual users shouldn't re-login weekly; 30-day sliding refresh means sign-in roughly once a month at worst |
| OAuth / hosted UI | Deferred (see federation below) | |

**Google/Apple federation — recommended for a later phase.** Both need external
developer accounts (Apple's is paid), and Apple's App Store rule means that the
moment you offer Google sign-in you are *required* to offer Sign in with Apple.
Email/password first ships auth without either dependency; federation slots in
later via the hosted UI without changing the backend at all (tokens come from
the same pool).

## 3. Token handling

- **Library:** Amplify v6, Auth category only (`aws-amplify/auth`) — the design
  doc lists it as the sanctioned convenience. It handles SRP, code
  confirmation, and automatic refresh-token rotation, and tree-shakes to just
  Auth.
- **Storage:** `expo-secure-store` (Keychain / Android Keystore) via Amplify's
  pluggable storage adapter. Tokens never touch AsyncStorage.
- **Which token goes to the API:** the **access token**, in
  `Authorization: Bearer …`. The backend verifier is already configured with
  `tokenUse: 'access'`, and API Gateway's JWT authorizer (Task 1) accepts
  access tokens via the `client_id` claim.
- **Email bootstrap wrinkle:** access tokens carry no `email` claim; the ID
  token does. `GET /me` already accepts an `x-user-email` header for the first
  call — the app will send its ID-token email there once. This header is
  client-asserted, which is acceptable for profile data (it is unique-checked,
  not trusted for authorization). If we ever want it verified, the backend can
  optionally verify the ID token for that one endpoint — noted, not planned.
- **Refresh:** `fetchAuthSession()` transparently refreshes; the existing
  `SyncOptions.getAccessToken` callback maps onto it one-to-one. No changes to
  `sync.ts`.

## 4. Wiring into the existing flow

**Backend: effectively nothing.** Set `COGNITO_USER_POOL_ID` +
`COGNITO_CLIENT_ID`, leave `DEV_USER_ID` unset outside local dev. Done.

**Mobile: all new, in small pieces.**

1. Per-env Cognito config (pool id, client id, region) via `app.json` →
   `expo-constants`, matching the debug-builds-point-at-dev rule.
2. `AuthProvider` context: session state, `getAccessToken`, sign-out.
3. Screens — **native forms, not the hosted UI, for MVP** (recommended): Sign
   in, Sign up, Confirm code, Forgot password. Rationale: the hosted UI is a
   browser redirect with Cognito's own styling — jarring in an otherwise native
   app, and Task 4's redesign would have no reach into it. The hosted UI
   becomes worthwhile only when federation arrives (it's how Google/Apple
   buttons come for free). Trade-off: four simple screens now vs. a visual seam.
4. Research-consent prompt at first sign-in → `PATCH /me` (endpoint exists).
5. **Dev Login button (debug builds only)** → signs into a seeded test account
   in the dev pool, per the design doc.
6. Wire `getAccessToken` into `runSync`; add a sync trigger + status to the
   dashboard.

**Auth posture (recommended): sign-in required once at first launch.** After
that everything works offline — tokens live in secure storage, capture never
touches the network, and sync simply pauses if a refresh fails and resumes
next time it succeeds. The alternative (anonymous local-only mode with
account-linking later) is real work: merging a local UUID universe into an
authenticated one deserves its own design, and the schema's client-generated
UUIDs make it *possible* later without blocking anything now.

## 5. One wrinkle worth knowing in advance

Cognito assigns `sub` — you cannot choose it. The seeded demo archer has a
fixed id (`11111111-…`), so the dev-pool test account's `sub` will not match,
and Dev Login would land on an empty profile. Fix at implementation time:
parameterize the demo seed's user id and re-seed dev with the test account's
real `sub`. Small, but it must be remembered or Dev Login looks broken.

## 6. Implementation order (when approved — small, reviewable steps)

1. **Script** `scripts/cognito-dev-setup` — creates dev pool + client + test
   user via AWS CLI, prints the env values. (Codified into IaC when Task 1's
   migration is approved; the script gets dev moving without it.)
2. **PR: mobile auth foundation** — Amplify config, SecureStore adapter,
   `AuthProvider`, sign-in/up/confirm/forgot screens, consent prompt, Dev Login.
3. **PR: sync wiring** — `getAccessToken` → `runSync`, sync button + status,
   demo-seed `sub` parameterization.
4. Backend PR only if the API-Gateway-claims option (Task 1, option B) is
   chosen — otherwise zero backend changes.

## Prerequisites from you

- An AWS account + region choice (needed before even the dev pool exists).
- Decisions: federation timing, native screens vs hosted UI, and the
  required-sign-in posture — recommendations above, all reversible except that
  federation forces the Apple rule.
