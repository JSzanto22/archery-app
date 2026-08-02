# backend

Node.js + TypeScript API. One Fastify app, served locally as a plain HTTP
server and in AWS as a single Lambda behind API Gateway.

Deliberately a thin durable store: it persists raw rows and serves them back.
Scoring, grouping and analytics happen in [`mobile/`](../mobile/), not here.

```
backend/
├── db/            SQL schema and seeds — see db/README.md
└── src/
    ├── app.ts     the Fastify app, shared by both entry points
    ├── server.ts  local HTTP entry point
    ├── lambda.ts  AWS entry point
    ├── env.ts     validated configuration
    ├── auth.ts    Cognito token verification
    ├── db/        Drizzle schema and connection pool
    └── routes/    me, gear, targets, sessions, photos, sync
```

## Running it

Start the database first, from the repository root:

```bash
docker compose up -d
```

Then:

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

The API listens on `http://localhost:3000`. `.env.example` sets `DEV_USER_ID` to
the seeded demo archer, so every request is authenticated as that user and you
get seven months of real-looking data immediately, with no Cognito pool.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/targets
curl "http://localhost:3000/sessions?limit=5"
```

```bash
npm test          # integration tests against the Docker Postgres
npm run typecheck
```

## Why one Lambda

The whole app runs as an ordinary Fastify server locally. That is the point:
development, tests and debugging need no AWS account, no emulator and no deploy.
A handler-per-route layout would have made `npm run dev` impossible and pushed
every integration test behind SAM.

`src/lambda.ts` builds the app at module scope so a warm container reuses both
the Fastify instance and the connection pool.

## Endpoints

| Area | Endpoints |
| --- | --- |
| Ops | `GET /health` (unauthenticated) |
| Profile | `GET /me`, `PATCH /me` |
| Gear | `GET/POST /gear`, `PATCH/DELETE /gear/:id` |
| Targets | `GET /targets`, `GET/POST /targets/:id`, `PATCH/DELETE /targets/:id` |
| Sessions | `GET /sessions`, `GET/POST/PATCH/DELETE /sessions/:id` |
| Rounds | `POST /sessions/:id/rounds`, `PATCH/DELETE /rounds/:id` |
| Arrows | `PUT /rounds/:id/arrows` (full replace) |
| Photos | `POST/GET /rounds/:id/photo-url` (pre-signed S3) |
| Sync | `GET /sync/pull?since=`, `POST /sync/push` |

## Rules that are load-bearing

**Identity comes from the token and nowhere else.** `request.userId` is the
verified `sub` claim. No route reads an owner from a body, a path or a header —
one that did would let any user read any other user's data by editing a field.
API Gateway's Cognito authorizer already rejects bad tokens; verifying again in
`auth.ts` keeps the app correct when run outside API Gateway.

**Ownership is enforced in the WHERE clause, not in a branch.** Every query
carries `eq(table.ownerId, request.userId)`. A row belonging to someone else
simply does not match.

**Missing and forbidden both return 404.** A 403 confirms the id exists, which
is information the caller has no right to.

**`DEV_USER_ID` cannot reach production.** It disables authentication entirely,
so `env.ts` refuses to start when it is set alongside `NODE_ENV=production`.

**`updated_at` is never stamped by the server.** It is the client's value and
the input to last-write-wins. See the migration's header comment.

**Drizzle does not own the schema.** `backend/db/migrations/0001_init.sql` is
the source of truth — it is what Docker and RDS run, and it encodes constraints
Drizzle cannot express. `src/db/schema.ts` mirrors it for typed queries;
`drizzle-kit generate` is intentionally not wired up. Change one, change the
other.

## Sync

`GET /sync/pull` returns WatermelonDB's change format using the *client's*
column names, because the device applies the rows straight into its local
schema. `owner_id` and `sync_status` are stripped (the device has neither
column) and `shape_params` is stringified (SQLite has no JSON type). The whole
pull runs in one transaction so a row written mid-pull cannot be skipped by this
pull and also fall behind the returned watermark.

`POST /sync/push` upserts with `WHERE excluded.updated_at > table.updated_at`,
so a stale copy arriving late never clobbers a newer one. Pushed children whose
parent is not the caller's are silently skipped — without that check, a hostile
client could rewrite the scoring rings of a shared preset for every user.

## Verified

21 integration tests run against the real Postgres, not a mock — the failures
worth catching here are constraint behaviour, NUMERIC round-tripping, ownership
filtering and the exact sync payload shape, all of which a stubbed database
would pass while broken. They cover ownership isolation between two users,
last-write-wins ordering, a push aimed at another user's session, preset
immutability, and coordinate precision.

## Not built yet

- Infrastructure as code. Nothing deploys this to AWS yet; there is no SAM, CDK
  or Terraform stack.
- Cognito is wired but untested against a real pool.
- `/sync/pull` cannot report deletions — the design gap written up in
  [`db/README.md`](db/README.md). The mobile client is already ready for them.
- `targets` has no `aspect_ratio` column, so non-square faces sync without their
  proportions. Same writeup.
