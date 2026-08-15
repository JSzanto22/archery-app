# AWS Cognito Integration Plan

_2026-08-01 — plan only; nothing has been implemented._

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

| Setting             | Value                                      | Why                                                                                                                                                                             |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in             | Email as username (case-insensitive alias) | The design's primary method                                                                                                                                                     |
| Verification        | Auto-send email code on sign-up            | Standard; blocks typo'd addresses                                                                                                                                               |
| Required attributes | `email` only                               | Everything else lives in Postgres                                                                                                                                               |
| Custom attributes   | **None**                                   | `research_consent`, display name etc. are app data — queried relationally, so they belong in the `users` table (already there), not in Cognito where they'd be invisible to SQL |
| MFA                 | Off for MVP                                | Casual-use app; revisit later                                                                                                                                                   |
| Account recovery    | Email                                      |                                                                                                                                                                                 |
| Deletion protection | On (prod only)                             |                                                                                                                                                                                 |

`users.id` mirrors the Cognito `sub`, as the schema already documents.

## 2. App client

| Setting           | Value                              | Why                                                                                                        |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Client type       | Public, **no secret**              | A mobile binary cannot keep a secret                                                                       |
| Auth flow         | `USER_SRP_AUTH` only               | Password never transits in plaintext; do not enable `USER_PASSWORD_AUTH` or admin flows                    |
| Token validity    | Access 1 h · ID 1 h · Refresh 30 d | Casual users shouldn't re-login weekly; 30-day sliding refresh means sign-in roughly once a month at worst |
| OAuth / hosted UI | Deferred (see federation below)    |                                                                                                            |

**Google/Apple federation — recommended for a later phase.** Both need external
developer accounts (Apple's is paid), and Apple's App Store rule means that the
moment you offer Google sign-in you are _required_ to offer Sign in with Apple.
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
- **Email bootstrap — superseded.** This plan originally had `GET /me` read the
  address from a client-asserted `x-user-email` header, on the reasoning that
  profile data need not be verified. That reasoning was wrong, and the header
  was removed during the security pass on 2026-08-14.

  `users.email` is `NOT NULL UNIQUE`, so a client-asserted value is not merely
  unverified — it is a claim on a scarce resource. Anyone could have sent a
  stranger's address on their own first `/me` call, taken that row, and left
  the real owner's first `/me` failing the unique constraint forever. An
  unauthenticated denial of service against a named individual, through a field
  we described as harmless.

  What replaced it: the email is read from the verified token when the pool
  supplies one, and otherwise a `{sub}@placeholder.invalid` is stored. Cognito
  access tokens normally carry no email claim, so in practice the placeholder
  is what lands.

  **That is fine, because nothing reads the column.** It is written on first
  call and never selected — not by the API, not by the app. Cognito owns
  identity and the real address. If a genuine need appears (contacting research
  participants, say), the honest ways to satisfy it are `AdminGetUser` at the
  point of use, or a pre-token-generation trigger that puts a verified `email`
  claim in the access token. Both keep the property that our copy only ever
  holds something AWS vouched for.

- **Refresh:** `fetchAuthSession()` transparently refreshes; the existing
  `SyncOptions.getAccessToken` callback maps onto it one-to-one. No changes to
  `sync.ts`.

## 4. Wiring into the existing flow

**Backend: done, and smaller than this said.** The CDK API stack sets
`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` and `TRUST_GATEWAY_AUTHORIZER`, and
`env.ts` refuses to start in production with `DEV_USER_ID` set.

The one change beyond configuration was option B from the deployment
assessment: behind API Gateway the JWT authorizer has already verified the
token, so `auth.ts` reads the subject from the event's claims rather than
fetching Cognito's JWKS — which the Lambda, sitting in a VPC with no internet
route, cannot do. In-app verification remains the path everywhere else.

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
UUIDs make it _possible_ later without blocking anything now.

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
