# Archery Tracker App — Technical Design (MVP)

Derived from the functional specification. Covers four things:

1. Normalized relational database schemas (Postgres)
2. Backend API endpoints
3. UI information requirements (what data each screen needs)
4. Cloud technologies and how they integrate with the backend

**Architecture principle (guiding all of the below):** the mobile device does the heavy lifting (scoring, grouping math, aggregation, analytics). The backend is primarily a durable raw-data store, doing transforms only where a computation is genuinely better centralized or infeasible on-device. Heavy AI inference is deferred and, when added, will run on-device where the hardware allows, falling back to backend only when a device can't handle it.

---

## Part 1 — Relational Database Schemas (Postgres, Normalized)

All tables use **client-generated UUID** primary keys (so offline-created rows sync without collisions). All user-owned tables carry `created_at` / `updated_at` and a `sync_status` where relevant. Third-normal-form throughout — no derived/aggregate values stored (score, grouping, etc. are all computed on-device).

### `users`

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | mirrors Cognito `sub` |
| email | TEXT UNIQUE NOT NULL | |
| display_name | TEXT | |
| research_consent | BOOLEAN NOT NULL DEFAULT false | consent for research/analytics use |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

*Auth methods (Google/Apple/email) are managed by Cognito, not stored here — Cognito is the source of truth for identity.*

### `gear_profiles`

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| owner_id | UUID (FK → users.id) NOT NULL | |
| name | TEXT NOT NULL | e.g. "Hoyt recurve setup" |
| bow_type | TEXT | recurve / compound / barebow / etc. (nullable) |
| notes | TEXT | |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

### `targets`

The reusable target definition. `owner_id` NULL = shared standard preset (World Archery / Olympic); non-null = user-created custom.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| owner_id | UUID (FK → users.id) NULLABLE | NULL = shared preset |
| name | TEXT NOT NULL | |
| type | TEXT NOT NULL | `preset` \| `custom` |
| base_shape | TEXT | outline shape of the physical target face (circle / rectangle / silhouette / freeform) |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

### `target_zones`

The scoring zones for a target, one row per zone. Built from **shape primitives** (circle, rectangle, polygon, etc.) rather than raw point-clouds — a circle stores center+radius, an irregular zone stores an ordered polygon. This keeps data light while supporting arbitrary targets (deer, box, silhouette).

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| target_id | UUID (FK → targets.id) NOT NULL | |
| zone_index | INT NOT NULL | ordering / layering (inner zones checked first) |
| score_value | INT NOT NULL | points awarded for a hit in this zone |
| shape_type | TEXT NOT NULL | `circle` \| `ellipse` \| `rectangle` \| `polygon` |
| shape_params | JSONB NOT NULL | geometry, normalized 0–1 to the target face — see below |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

**`shape_params` by `shape_type` (all coordinates normalized 0–1):**

- `circle`: `{ "cx": 0.5, "cy": 0.5, "r": 0.1 }`
- `ellipse`: `{ "cx": 0.5, "cy": 0.5, "rx": 0.1, "ry": 0.15, "rot": 0 }`
- `rectangle`: `{ "x": 0.2, "y": 0.3, "w": 0.4, "h": 0.2, "rot": 0 }`
- `polygon`: `{ "points": [[x1,y1],[x2,y2], ...] }`

Scoring an arrow = test its (x,y) against zones in `zone_index` order (innermost/highest first), assign the first zone it falls inside. Computed **on-device**.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| owner_id | UUID (FK → users.id) NOT NULL | |
| shot_at | TIMESTAMPTZ NOT NULL | when the session took place |
| distance_m | NUMERIC | shooting distance in meters (nullable) |
| gear_profile_id | UUID (FK → gear_profiles.id) NULLABLE | saved gear, OR use the free-text tag |
| equipment_tag | TEXT | free-text alternative to a gear profile |
| location | TEXT | optional |
| notes | TEXT | optional |
| sync_status | TEXT NOT NULL | `pending` \| `synced` |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

### `rounds`

One board within a session.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| session_id | UUID (FK → sessions.id) NOT NULL | |
| target_id | UUID (FK → targets.id) NOT NULL | which target this board used |
| round_order | INT NOT NULL | position within the session |
| photo_key | TEXT | S3 object key; NULL if no photo (manual entry) |
| sync_status | TEXT NOT NULL | `pending` \| `synced` |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

### `arrows`

One mark within a round. Free-form count.

| Column | Type | Notes |
|---|---|---|
| id | UUID (PK) | |
| round_id | UUID (FK → rounds.id) NOT NULL | |
| x | NUMERIC NOT NULL | normalized 0–1 on the target face |
| y | NUMERIC NOT NULL | normalized 0–1 on the target face |
| score_value | INT NOT NULL | resolved zone score at mark time (stored because it depends on the target definition *as it was*; recomputable but cheap to persist) |
| shot_order | INT | order within the round (nullable) |
| created_at | TIMESTAMPTZ NOT NULL | |
| updated_at | TIMESTAMPTZ NOT NULL | |

*Note: `score_value` is the one lightly-denormalized field — it's the resolved zone result, kept so historical scores stay stable even if a custom target is later edited. `x`/`y` remain the raw truth; distance-from-center and grouping are computed on-device, never stored.*

### Relationship summary

```
users 1───∞ gear_profiles
users 1───∞ targets (custom; presets have null owner)
users 1───∞ sessions
targets 1───∞ target_zones
sessions 1───∞ rounds
rounds   1───∞ arrows
targets  1───∞ rounds   (a target is referenced by many rounds)
gear_profiles 1───∞ sessions (optional)
```

### Indexes worth having

- `sessions (owner_id, shot_at)` — the dashboard's primary query (a user's sessions in a date range)
- `rounds (session_id, round_order)`
- `arrows (round_id)`
- `target_zones (target_id, zone_index)`
- `targets (owner_id)` — list a user's custom targets + presets

---

## Part 2 — Backend API Endpoints

REST over API Gateway → Lambda. All endpoints (except health) require a valid Cognito JWT; the authenticated user id comes from the token, never from the request body. Sync-oriented: the client pushes local changes and pulls remote changes.

### Auth

Auth itself is handled by Cognito (hosted UI / SDK), not custom endpoints. The backend only *validates* Cognito-issued tokens.

- `GET /me` — return the current user's profile (creates the `users` row on first call if absent)
- `PATCH /me` — update display name, research_consent

### Gear profiles

- `GET /gear` — list the user's gear profiles
- `POST /gear` — create
- `PATCH /gear/{id}` — update
- `DELETE /gear/{id}` — delete

### Targets

- `GET /targets` — list presets (owner null) + the user's custom targets, each with its zones
- `GET /targets/{id}` — single target with zones
- `POST /targets` — create a custom target (with its zones in one payload)
- `PATCH /targets/{id}` — update a custom target + zones (owner-only)
- `DELETE /targets/{id}` — delete a custom target (owner-only)

### Sessions / rounds / arrows

Nested resources; writes accept the full sub-tree for offline sync efficiency.

- `GET /sessions?from=&to=&distance=&target_type=&gear_id=` — list sessions in a range, with optional advanced filters
- `GET /sessions/{id}` — full session incl. rounds + arrows
- `POST /sessions` — create a session (optionally with nested rounds/arrows in one call)
- `PATCH /sessions/{id}` — update session metadata
- `DELETE /sessions/{id}` — delete a session (cascades to rounds/arrows)
- `POST /sessions/{id}/rounds` — add a round
- `PATCH /rounds/{id}` — update a round (target, order, photo_key)
- `DELETE /rounds/{id}`
- `PUT /rounds/{id}/arrows` — replace the full arrow set for a round (simplest for the tap-to-mark edit flow)

### Photo upload (pre-signed URL / direct-to-S3)

- `POST /rounds/{id}/photo-url` — backend returns a short-lived **pre-signed S3 PUT URL** + the object key; the app uploads the image bytes directly to S3, then `PATCH /rounds/{id}` with the returned `photo_key`
- `GET /rounds/{id}/photo-url` — backend returns a short-lived pre-signed GET URL to view the photo

### Sync

- `POST /sync/push` — client sends a batch of created/updated/deleted records (sessions, rounds, arrows, targets, gear) with client UUIDs and `updated_at`; server applies last-write-wins by timestamp
- `GET /sync/pull?since=` — server returns everything changed for this user since a timestamp (for multi-device / restore)

### Ops

- `GET /health` — unauthenticated health check

---

## Part 3 — UI Information Requirements (data each screen needs)

What data each screen must have available — not layout, just the information contract.

### Auth / Onboarding

- Available login methods (email/password, Google, Apple)
- Research-consent prompt (writes `research_consent`)
- (Dev builds only) Dev Login button → seeded test account

### Home / Dashboard

- Selected date range (default + custom)
- Aggregates over the range (all computed on-device from local data):
  - Score trend series (score per session over time)
  - Grouping trend series (avg arrow distance from centroid per session)
  - Aggregated heat map data (all arrow x/y across the range → density/bias)
  - Personal bests (best session score, tightest grouping)
- Session list for the range: date, distance, gear label, total score, arrow count
- **Advanced filters (collapsed by default):** distance, target type, gear profile

### Session Detail

- Session metadata: date, distance, gear (profile name or tag), location, notes
- Ordered list of rounds
- Per round: target (name + zone geometry to render), photo (if any), arrow marks, round score, round grouping
- Session totals: total score, avg per arrow, overall grouping

### Round Detail / Marking

- Selected target's zone geometry (to render rings/shapes and to score taps)
- Photo (optional background) or blank target diagram
- Existing arrow marks (x/y, score) for edit
- Live-updating round score + grouping as marks change

### Target Library

- List of presets + user's custom targets (name, thumbnail/outline, type)
- For each: zone definitions (to render + score)

### Custom Target Builder

- Captured/selected outline shape of the physical target
- Palette of shape primitives (circle, ellipse, rectangle, polygon)
- Inferred zones from the scan (editable) + per-zone score assignment
- Ability to add/move/delete zones and adjust points

### Gear Management

- List of gear profiles (name, bow type, notes)
- Create/edit forms

---

## Part 4 — Cloud Technologies & Backend Integration

| Technology | Role | Integration point |
|---|---|---|
| **AWS Cognito** | Authentication (email/password + Google + Apple OAuth); issues JWTs | Mobile app authenticates via Cognito SDK/hosted UI; **API Gateway uses a Cognito Authorizer** to validate the JWT on every protected endpoint; backend reads user id from the verified token (`sub`) |
| **API Gateway** | HTTP entry point / routing / auth enforcement | Fronts all Lambda functions; Cognito authorizer attached; CORS configured for the app |
| **AWS Lambda** | Backend compute (the endpoints above) | Invoked by API Gateway; connects to RDS; issues S3 pre-signed URLs |
| **Amazon RDS (Postgres)** | Durable relational store (all schemas in Part 1) | Lambda connects via RDS Proxy (pooled connections, since Lambda scales horizontally) |
| **Amazon S3** | Round photo storage | App uploads **directly** via pre-signed URLs from Lambda; DB stores only the `photo_key`; never store image bytes in Postgres |
| **RDS Proxy** | Connection pooling for Lambda↔Postgres | Prevents connection exhaustion under Lambda concurrency |
| **CloudWatch** | Logging / metrics / alarms | Lambda + API Gateway emit logs/metrics; alarms on errors/latency |
| **AWS Amplify (optional)** | Client SDK convenience | Simplifies Cognito auth + API calls from React Native (optional; can use raw SDKs instead) |
| **On-device: WatermelonDB** | Local source of truth, offline capture | Mirrors the Postgres schema; syncs via `/sync/push` + `/sync/pull` |

### Environments

Separate **dev / staging / prod** stacks: separate Cognito user pools, API Gateway stages, RDS instances (or databases), and S3 buckets. Debug builds point at the dev stack automatically; the Dev Login button targets a seeded dev-pool test account.

### Deferred (later phases, noted for architecture continuity)

- **SageMaker / on-device ML** for CV arrow detection — inference runs on-device where hardware (NPU) allows, with a capability check falling back to a backend inference endpoint only when a device can't perform it acceptably.
- The `rounds.photo_key` + arrow x/y schema already accommodates CV: detection will produce the same arrow x/y the manual flow produces, so no schema change is needed to add it later.

---

## Design Notes & Rationale

- **No stored aggregates:** score/grouping/heat-map are all derivable from `arrows.x/y` + `target_zones`, computed on-device — keeps the DB normalized and the backend a dumb store, per the architecture principle. (`arrows.score_value` is the one exception, persisted so historical scores survive later target edits.)
- **Shape primitives over point-clouds:** circles/rectangles store a handful of parameters; only truly irregular zones use polygons — light data, arbitrary targets supported.
- **Direct-to-S3 uploads** keep image bytes out of Lambda and Postgres entirely.
- **Client UUIDs + last-write-wins sync** make offline capture safe without server round-trips at capture time.
