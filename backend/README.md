# backend

REST API over API Gateway → Lambda, backed by RDS Postgres and S3.

Deliberately a thin durable store: it persists raw rows and serves them back.
Scoring, grouping, and analytics happen in [`mobile/`](../mobile/), not here.

## Responsibilities

- CRUD for users, gear profiles, targets + zones, sessions, rounds, arrows
- Sync endpoints (`/sync/push`, `/sync/pull`) with last-write-wins by `updated_at`
- Pre-signed S3 URLs for round photo upload and viewing
- Token validation — never trust a user id from a request body

## Endpoints

Full list with parameters in
[`docs/technical-design.md`](../docs/technical-design.md) Part 2. Summary:

| Area | Endpoints |
| --- | --- |
| Profile | `GET /me`, `PATCH /me` |
| Gear | `GET/POST /gear`, `PATCH/DELETE /gear/{id}` |
| Targets | `GET /targets`, `GET/POST/PATCH/DELETE /targets/{id}` |
| Sessions | `GET /sessions`, `GET/POST/PATCH/DELETE /sessions/{id}` |
| Rounds | `POST /sessions/{id}/rounds`, `PATCH/DELETE /rounds/{id}` |
| Arrows | `PUT /rounds/{id}/arrows` (full replace) |
| Photos | `POST/GET /rounds/{id}/photo-url` (pre-signed) |
| Sync | `POST /sync/push`, `GET /sync/pull?since=` |
| Ops | `GET /health` (unauthenticated) |

## Rules

- **Auth comes from the token.** API Gateway's Cognito authorizer validates the
  JWT; the owner id is the verified `sub`. A user id in a request body is ignored.
- **Ownership is enforced on every read and write.** Users only ever touch their
  own rows; targets with a null `owner_id` are shared read-only presets.
- **Connect through RDS Proxy**, not directly to Postgres — Lambda concurrency
  will otherwise exhaust connections.
- **Image bytes never enter Lambda or Postgres.** The app uploads straight to S3
  with a pre-signed URL; the database stores only `photo_key`.
- **No secrets in the repo.** Config comes from environment variables; document
  required ones here and keep a `.env.example` alongside the code.

## Environments

Separate dev / staging / prod stacks — separate Cognito user pools, API Gateway
stages, RDS instances, and S3 buckets. The dev pool holds a seeded test account
for the debug-build Dev Login button.
