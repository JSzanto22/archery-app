# mobile

React Native client. This is where nearly all the logic lives — see the
architecture principle in the [root README](../README.md).

## Responsibilities

- **Local source of truth.** WatermelonDB mirrors the Postgres schema; capture
  works fully offline and syncs later via `/sync/push` and `/sync/pull`.
- **Scoring.** Test an arrow's normalized (x, y) against `target_zones` in
  `zone_index` order (innermost first); first zone containing the point wins.
- **Analytics.** Score trends, grouping (avg arrow distance from centroid), heat
  maps, personal bests — all computed on-device from local data, never stored.
- **Capture.** Photo of the target face, tap-to-mark arrows over it.
- **Auth.** Cognito (email/password, Google, Apple); JWT attached to API calls.

## Screens and their data contracts

Per-screen information requirements are specified in
[`docs/technical-design.md`](../docs/technical-design.md) Part 3:

- Auth / Onboarding — login methods, research-consent prompt, dev-login (debug builds)
- Home / Dashboard — date range, trend series, heat map, personal bests, session list
- Session Detail — metadata, ordered rounds, per-round score and grouping, totals
- Round Detail / Marking — zone geometry, optional photo background, live score
- Target Library — presets + custom targets with zone definitions
- Custom Target Builder — outline capture, shape primitives, per-zone scores
- Gear Management — profile list and edit forms

## Conventions

- **Generate UUIDs client-side** for every row. Never wait on the server for an id.
- **Normalized coordinates.** Arrow x/y and all zone geometry are 0–1 relative to
  the target face, so rendering and scoring are resolution-independent.
- **Don't persist derived values.** Grouping and distance-from-center are computed
  on read. The sole exception is `arrows.score_value`, stored at mark time so
  historical scores survive later edits to a custom target.
- Debug builds point at the dev stack automatically.
