# Database

Postgres schema for the Archery Tracker, implementing Part 1 of
[`docs/technical-design.md`](../../docs/technical-design.md).

```
backend/db/
├── migrations/
│   └── 0001_init.sql            # schema: tables, constraints, indexes
├── seeds/
│   ├── 0001_preset_targets.sql  # World Archery faces — every environment
│   └── 0002_demo_data.sql       # fabricated archer history — DEV ONLY
└── README.md
```

## Running it

From the repository root:

```bash
docker compose up -d
```

Postgres 16 comes up on `localhost:5432`, runs the migration, loads the presets,
and seeds a demo archer — all on first start only. Connection string for local
development:

```
postgresql://archery:archery_dev@localhost:5432/archery
```

Open a psql shell:

```bash
docker exec -it archery-db psql -U archery -d archery
```

Optional web SQL client at `http://localhost:8080`:

```bash
docker compose --profile tools up -d
```

**Re-seeding.** The init scripts run only against an empty data directory, so
editing a `.sql` file changes nothing until the volume is dropped:

```bash
docker compose down -v && docker compose up -d
```

Port, database name and credentials can be overridden with `POSTGRES_PORT`,
`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` in a root `.env`.

## Two schema conventions that are easy to break

**Primary keys are client-generated.** There is deliberately no
`DEFAULT gen_random_uuid()` on any `id`. Offline capture mints UUIDs on the
device before a row ever reaches this database. A server-side default would let
some code path invent an id the client never learns about, which is precisely the
collision the design avoids.

**`updated_at` is client-supplied and authoritative.** `/sync/push` resolves
conflicts last-write-wins by comparing the client's `updated_at`. Do **not** add
the usual `BEFORE UPDATE` trigger that stamps `now()` — it would overwrite the
timestamp conflict resolution depends on and silently break sync. The
`DEFAULT now()` exists only so hand-written SQL and seeds work.

## Preset targets

Preset ids are fixed, not generated, so a target reference resolves to the same
row in every environment:

| Target | id suffix | Zones | Scores |
| --- | --- | --- | --- |
| WA 122 cm (10 ring) | `…101` | 10 circles | 10–1 |
| WA 80 cm (10 ring) | `…102` | 10 circles | 10–1 |
| WA 80 cm compound (6 ring) | `…103` | 6 circles | 10–5 |
| WA 40 cm vertical 3-spot | `…104` | 15 ellipses | 10–6 |

Because geometry is normalized to the face, the 122 cm and 80 cm ten-ring faces
are *geometrically identical* here — they differ only in physical size, which
lives in the name and in `sessions.distance_m`.

The inner-10 (X) ring is omitted: it scores the same 10 and exists only to break
ties, which is a competition-format concern rather than a scoring-geometry one.
Add it as an extra innermost zone if tiebreaks are ever needed.

## Demo data

`0002_demo_data.sql` is **dev and test only**. It builds seven months of history
for one archer: 46 sessions, 299 rounds, 1,187 arrows across indoor 3-spot, 30 m,
50 m compound, 70 m, and a 3D course, plus a user-built deer target with polygon
zones.

What makes it useful is that it is consistent with how the app is actually used:

- Arrow positions come from a **2D normal distribution** around the aim point,
  because that is how groups genuinely scatter. Uniform random x/y would make
  heat maps and grouping figures look like noise and would hide any analytics bug
  a real group would expose.
- The group **tightens over the seeded period** and a low-left bias shrinks with
  it, so the dashboard's trend lines have something true to show. Measured within
  the 70 m sessions: grouping goes 0.160 → 0.091 and mean arrow score 7.46 → 8.67,
  with the group centroid converging on (0.5, 0.5).
- About **6% of arrows are flyers** drawn from a much wider spread, and 11 arrows
  miss the target entirely (`score_value = 0`). Code that assumes a clean
  distribution should meet one of these in dev, not in the field.
- `score_value` is resolved by **genuinely testing each arrow against the
  target's zones**, never guessed. Verified: re-deriving the score for all 690
  arrows on concentric-circle faces from geometry alone produces 0 mismatches.
- The two most recent sessions are left `sync_status = 'pending'`, so the
  offline/unsynced UI path has data the moment you open the app.
- Two sessions use `equipment_tag` free text with no gear profile (borrowed kit),
  and about a third of rounds have no `photo_key` (entered by hand).

Shot scatter is deterministic — `setseed(0.4242)` — so re-seeding reproduces the
same history and screenshots stay comparable. Row ids are not deterministic.

The scoring helpers the seed uses live in `pg_temp` and vanish with the session.
Scoring belongs on the device; a permanent `score_arrow()` in the schema would
invite the backend to start using it.

## Two gaps in the design, found while building this

Neither is fixed here — the schema implements the design as written. Both need a
decision before the sync work starts.

**1. Hard deletes cannot propagate through `/sync/pull`.** The design specifies
`DELETE /sessions/{id}` as a real delete with cascade, and `/sync/pull?since=`
as "everything changed since a timestamp." A deleted row has no timestamp and no
row — so a second device will never learn the session is gone, and will happily
push it back on its next sync. Any of these fixes it: a `deleted_at` soft-delete
column with pull filtering it out, a `tombstones` table recording (id, table,
deleted_at, owner_id), or a per-user monotonic change counter. Soft delete is
the least machinery; tombstones keep the live tables clean.

**2. Normalized coordinates lose the aspect ratio of non-square faces.** The
WA 40 cm vertical 3-spot is 40 cm wide by 120 cm tall. Normalizing both axes to
0–1 squashes it, so a physically circular scoring ring has to be stored as an
ellipse whose `ry` is exactly one third of its `rx` — which is why that preset
uses `ellipse` and the round faces use `circle`. It works, but it means zone
geometry silently encodes the face's proportions, and a target photographed at a
different aspect ratio will not score correctly against it. An `aspect_ratio`
(or `width_cm` / `height_cm`) column on `targets` would let the device letterbox
the photo to the stored proportions before scoring. This also affects the
custom-target builder, which currently has no way to record the shape of the
thing it scanned.

A third, smaller note: on the 3-spot, per-session "grouping" is meaningless if
computed as spread about a single centroid, because the arrows are deliberately
aimed at three different points. Grouping needs to be computed per aim point on
multi-spot faces. This is on-device analytics, not schema, but the seed data will
expose it immediately.
