# Infrastructure

AWS CDK app (TypeScript) that provisions everything the backend runs on.

TypeScript rather than Terraform so infrastructure is reviewed in the same
language, and the same pull request, as the code it serves — the reasoning is
in [`docs/lambda-deployment-assessment.md`](../docs/lambda-deployment-assessment.md).

## What is here so far

| Stack                   | Contents                         |
| ----------------------- | -------------------------------- |
| `Archery-<env>-Auth`    | Cognito user pool and app client |
| `Archery-<env>-Storage` | S3 bucket for round photos       |

Still to come: VPC, RDS Postgres behind RDS Proxy, the Lambda and HTTP API, and
the migration runner.

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
2. A region. Defaults to `eu-west-2`, matching the backend's own default.
   Override with `CDK_DEFAULT_REGION`.
3. One-time bootstrap per account/region — this creates the S3 bucket and roles
   CDK itself needs:

```bash
npx cdk bootstrap
```

## Deploying

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

## Outputs you need

After deploying, the stack outputs give you the backend's environment:

| Output             | Backend variable       |
| ------------------ | ---------------------- |
| `UserPoolId`       | `COGNITO_USER_POOL_ID` |
| `UserPoolClientId` | `COGNITO_CLIENT_ID`    |
| `PhotoBucketName`  | `S3_BUCKET`            |

The same pool id and client id go into the mobile app's per-environment config.

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
