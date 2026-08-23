# Infrastructure

AWS CDK app (TypeScript) that provisions everything the backend runs on.

TypeScript rather than Terraform so infrastructure is reviewed in the same
language, and the same pull request, as the code it serves — the reasoning is
in [`docs/lambda-deployment-assessment.md`](../docs/lambda-deployment-assessment.md).

## The stacks

| Stack                   | Contents                                   |
| ----------------------- | ------------------------------------------ |
| `Archery-<env>-Auth`    | Cognito user pool and app client           |
| `Archery-<env>-Storage` | S3 bucket for round photos                 |
| `Archery-<env>-Data`    | VPC, Postgres, RDS Proxy                   |
| `Archery-<env>-Api`     | Lambda, HTTP API, and the migration runner |

Stacks are split by **lifecycle**, not by service. The database and the photo
bucket outlive every deploy of the API, so a routine application deploy cannot
roll back a change to durable state, and a mistake in the API stack cannot take
the data with it.

## Environments

Two, selected by context:

```bash
npm run deploy -- -c env=dev
```

`dev` is the default, so the dangerous one has to be asked for by name. Every
difference between them is in [`lib/config.ts`](lib/config.ts) — one table, so
"what is actually different about production?" is a question you can answer by
reading rather than by grepping for `isProd`.

The headline differences: production retains its data on stack deletion, turns
on deletion protection and versioning, keeps logs for 90 days rather than 7,
and allows no browser origins at all.

## Prerequisites

1. An AWS account, and credentials on your shell (`aws configure` or SSO).
2. A region. `eu-west-2`, matching the backend's own default, stated in
   [`lib/config.ts`](lib/config.ts). Override deliberately with `-c region=…`.

   It is not read from `CDK_DEFAULT_REGION` on purpose: the CDK CLI sets that
   variable itself from resolved credentials, so a fallback in the app never
   runs and an unconfigured machine silently deploys to `us-east-1`.

3. One-time bootstrap per account/region — this creates the S3 bucket and roles
   CDK itself needs:

```bash
npx cdk bootstrap
```

## Deploying

The deployed Lambda has no internet access, so Amazon's RDS certificate bundle
has to be baked into the artifact at build time. Fetch it first — the API stack
refuses to synthesise without it:

```bash
npm run fetch:rds-ca --prefix ../backend
```

Then:

```bash
npm install
npm run synth
```

`synth` needs no AWS credentials, so the templates can be reviewed — and are
checked in CI — before anyone has an account. Then:

```bash
npm run diff -- -c env=dev
npm run deploy -- -c env=dev
```

Always read the `diff` first. On the durable stacks it is the difference
between a change and a replacement, and CloudFormation will replace a database
without asking twice.

### Migrations

The database is in isolated subnets with no public address, so nothing outside
the VPC can reach it — including your laptop. Migrations run as a Lambda,
invoked explicitly after a deploy:

```bash
aws lambda invoke --function-name archery-dev-migrate --region eu-west-2 /dev/stdout
```

Deliberately not automatic. A migration that fails half way through cannot be
undone by a CloudFormation rollback, and a custom resource that fails can hold
a stack hostage for an hour; as its own step, a failure is a failure of that
step with the output in front of whoever ran it.

It is safe to re-run — applied files are recorded and skipped. Editing a
migration that has already run is refused by a checksum comparison, because the
alternative is two environments with different schemas and no explanation.

The demo seed (`0002_demo_data.sql`) is excluded from the runner. It is a
fabricated archer with a season of invented scores: useful locally, actively
harmful in a real database.

## Outputs you need

After deploying, the stack outputs give you the backend's environment:

| Output             | Used for                                          |
| ------------------ | ------------------------------------------------- |
| `UserPoolId`       | `COGNITO_USER_POOL_ID`, and the mobile app config |
| `UserPoolClientId` | `COGNITO_CLIENT_ID`, and the mobile app config    |
| `PhotoBucketName`  | `S3_BUCKET`                                       |
| `ApiUrl`           | The mobile app's base URL                         |
| `MigrateCommand`   | The exact `aws lambda invoke` to run migrations   |

The API stack sets the Lambda's own environment from the other stacks directly,
so these are for the mobile app and for anyone running the backend by hand —
not something you have to copy into a deployment.

## Known limits, before they surprise you

**Cognito's default email sender is capped at roughly 50 messages a day.** That
covers development and a small pilot. Real signup volume needs SES, which in
turn needs a verified domain and a move out of the SES sandbox — allow a couple
of days for AWS to approve that, because it is not instant and it will block
signups on launch day if left to the last minute.

**MFA is off**, deliberately, per
[`docs/cognito-integration-plan.md`](../docs/cognito-integration-plan.md).
This is a casual scoring app, and mandatory MFA on a phone at a field range
with no signal locks people out of their own practice notes. Revisit if
anything more sensitive than shooting history ever lands here.

**Sub is assigned by Cognito, not chosen.** The demo seed's archer has a fixed
uuid, so a test account's `sub` will not match it and a dev sign-in lands on an
empty profile. The seed needs parameterizing at the point the mobile auth work
lands — small, but it looks like a bug if forgotten.

## Cost, roughly

At MVP traffic the API, Lambda, S3 and Cognito are pennies. The database
dominates: `db.t4g.micro` is about $12/month and RDS Proxy adds about $11.
Following the deployment assessment's recommendation to trust the API Gateway
authorizer rather than re-verifying JWTs from inside the VPC avoids a NAT
gateway, which would be another $32/month plus data.
