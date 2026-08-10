# AWS Lambda Deployment Assessment

_2026-08-01 — assessment only; nothing has been migrated._

## Verdict

**Yes — deployable with small, contained changes.** The backend was shaped for
Lambda from the start, so the work is almost entirely infrastructure, not
application code. Two real decisions and one genuine snag are listed at the end.

## What is already Lambda-ready

| Concern        | State                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler        | [`src/lambda.ts`](../backend/src/lambda.ts) already wraps the Fastify app with `@fastify/aws-lambda`; app and DB pool are built at module scope so warm containers reuse both |
| Statelessness  | No server-side sessions; identity is re-derived from the JWT on every request; the only state is Postgres                                                                     |
| Env config     | `env.ts` validates at module load, so a misconfigured function fails at deploy, not on a user's request. `DEV_USER_ID` is hard-refused in production                          |
| Large payloads | Photos go direct to S3 via pre-signed URLs; image bytes never transit Lambda                                                                                                  |
| Logging        | Pino to stdout → CloudWatch as-is; auth headers already redacted                                                                                                              |
| Health check   | `GET /health` unauthenticated, usable by synthetic monitors                                                                                                                   |

## Required changes

**1. Packaging (the main code-adjacent work).** Add an esbuild bundling step:
ESM output, single file, minified, `pg` and the AWS SDK bundled in. Node 22
runtime. Estimated bundle well under 2 MB → cold starts in the low hundreds of
ms; no provisioned concurrency needed at MVP traffic. Top-level `await` in
`lambda.ts` is fine on the ESM runtime but the zip must be identified as ESM
(`.mjs` or a `"type": "module"` package.json inside the artifact).

**2. API Gateway.** HTTP API (payload v2 — `@fastify/aws-lambda` handles it)
with the Cognito JWT authorizer in front. CORS moves to the gateway; the
in-app CORS stays harmless for local dev.

**3. Database connection.** Per the design doc: RDS Postgres behind **RDS
Proxy**, because each concurrent Lambda container owns its own pool (`max: 5`)
and direct connections multiply into exhaustion. `DATABASE_URL` should come
from Secrets Manager, injected at deploy. The current
`ssl: { rejectUnauthorized: true }` needs the RDS CA bundle supplied, or it
will reject RDS's cert.

**4. Migrations.** The SQL runs today only via Docker's initdb hook. RDS needs
an explicit migration step — simplest is a CI job or one-off script that runs
`migrations/*.sql` then `seeds/0001_preset_targets.sql` (presets only — the
demo seed must never leave dev).

**5. VPC wiring.** Lambda joins the RDS VPC. Add a free S3 gateway endpoint for
bucket traffic. This creates the one snag below.

## The one genuine snag

`auth.ts` verifies JWTs in-app with `aws-jwt-verify`, which fetches Cognito's
JWKS over the public internet. A Lambda inside a VPC has no internet unless you
add a NAT gateway (~$32/mo + data). Options:

- **A. NAT gateway** — keeps in-app verification everywhere. Cleanest, costs the most.
- **B. Trust the API Gateway authorizer in production** — the gateway has
  already verified the token; the function reads claims from the request
  context instead of re-verifying. Zero infra cost; in-app verification remains
  for local/tests. Requires a small, well-commented branch in `auth.ts`.
- **C. Lambda outside the VPC, RDS publicly addressable with TLS + tight
  security group** — cheapest and simplest; weaker posture. Common for MVPs,
  worth rejecting consciously rather than by default.

Recommendation: **B** — it uses the authorizer we already pay for, and the code
change is ~20 lines.

## Blockers (none are application code)

1. **No IaC exists.** Nothing provisions API Gateway, Lambda, RDS, S3, or the
   VPC. Tool choice needed — recommendation: **AWS CDK (TypeScript)**, matching
   the repo's language and keeping infra reviewable in the same PRs. SAM is the
   lighter alternative if you'd rather stay minimal.
2. **No Cognito user pool exists yet** (Task 2 covers it; the authorizer in
   change 2 depends on it).
3. **AWS account decisions:** region, and rough cost posture. Realistic dev
   stack: RDS `db.t4g.micro` (~$12/mo) + RDS Proxy (~$11/mo minimum) + S3/API
   GW/Lambda (pennies at MVP traffic). Option B above avoids the NAT's $32/mo.

## Explicitly out of scope for the migration

- The mobile app — it only needs a base URL swap per environment.
- The sync protocol, schema, and seeds — unchanged.
- The deletion-propagation gap in `/sync/pull` (documented in
  `backend/db/README.md`) — orthogonal to where the backend runs.
