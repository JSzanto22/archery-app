# archery-app

Archery training tracker: capture sessions, mark arrows on a target face, and
track score and grouping trends over time. Computer-vision arrow detection is a
later phase.

**Architecture principle:** the mobile device does the heavy lifting — scoring,
grouping math, aggregation, analytics. The backend is primarily a durable raw-data
store, transforming only where a computation is genuinely better centralized or
infeasible on-device. AI inference is deferred, and when added runs on-device
where the hardware allows, falling back to the backend only when it can't.

Full design: [`docs/technical-design.md`](docs/technical-design.md) — database
schemas, API endpoints, per-screen data contracts, and cloud integration.

## Repository layout

```
archery-app/
├── mobile/          # React Native app + WatermelonDB local store
├── backend/         # API Gateway → Lambda, RDS Postgres, S3
├── ml/              # CV model code (Phase 2+)
├── docs/            # architecture notes, design docs, failure logs
└── README.md
```

| Directory | Purpose |
| --- | --- |
| [`mobile/`](mobile/) | Client app. Local source of truth, all scoring and analytics. |
| [`backend/`](backend/) | Serverless API, Postgres persistence, photo storage. |
| [`ml/`](ml/) | Computer-vision arrow detection. Phase 2+. |
| [`docs/`](docs/) | Design docs, decision records, failure logs. |

Each directory has its own `README.md` describing what belongs there.

## Stack

| Layer | Choice |
| --- | --- |
| Client | React Native |
| Local store | WatermelonDB (mirrors the Postgres schema, syncs via push/pull) |
| Auth | AWS Cognito (email/password, Google, Apple) |
| API | API Gateway + Lambda, Cognito authorizer |
| Database | Amazon RDS Postgres, via RDS Proxy |
| Media | S3, direct upload via pre-signed URLs |
| Observability | CloudWatch |

## Data model at a glance

```
users 1───∞ gear_profiles
users 1───∞ targets (custom; presets have null owner)
users 1───∞ sessions
targets 1───∞ target_zones
sessions 1───∞ rounds
rounds   1───∞ arrows
targets  1───∞ rounds
gear_profiles 1───∞ sessions (optional)
```

Client-generated UUIDs throughout, so offline-created rows sync without
collisions. No stored aggregates — score, grouping, and heat maps are all derived
from `arrows.x/y` + `target_zones` on-device.

## Environments

Separate dev / staging / prod stacks: separate Cognito user pools, API Gateway
stages, RDS instances, and S3 buckets. Debug builds point at dev automatically.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Mobile capture, manual marking, sync, dashboard | Not started |
| 2 | CV arrow detection (on-device, backend fallback) | Not started |
