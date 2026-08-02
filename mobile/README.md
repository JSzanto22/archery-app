# mobile

React Native client, Expo SDK 53 with a custom dev client. This is where nearly
all the logic lives — see the architecture principle in the
[root README](../README.md).

## Running it

WatermelonDB uses native modules and the JSI adapter, so **Expo Go will not
work**. You need a dev client:

```bash
npm install
npx expo prebuild
npx expo run:android
```

Then day to day:

```bash
npm start
```

`npx expo run:ios` needs macOS. From Windows, build iOS through EAS instead.

## Testing on a real Android phone (EAS cloud build)

No local Android SDK or JDK needed — the dev client is built in Expo's cloud
and installed once; day-to-day iteration then happens over Wi-Fi.

One-time setup (interactive — run these yourself):

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android
```

The first build prompts to create the EAS project and generate an Android
keystore — accept the defaults. Free-tier builds queue for ~10–30 minutes.
When it finishes, open the printed URL (or scan the QR) **on the phone**,
download the APK, and allow the install.

Daily loop:

```bash
npm start
```

Open the installed **Archery Tracker** dev app on the phone — it finds the dev
server on the same Wi-Fi (or scan the QR from the terminal). JS/TS changes
arrive by fast refresh; **no rebuild needed**. Rebuild through EAS only when
native pieces change: a new native dependency, or an `app.json` plugin change.

Troubleshooting:

- Windows Firewall will ask about Node the first time — allow it on private
  networks (Metro listens on port 8081).
- Phone can't find the server (AP isolation, hotel Wi-Fi):
  `npx expo start --dev-client --tunnel`.
- The backend is a separate concern: when sync is wired up, the phone must use
  the PC's LAN IP (e.g. `http://192.168.x.x:3000`), never `localhost`.

```bash
npm test
npm run typecheck
```

## What is built

The end-to-end slice: create a session → mark arrows on the face → live score
and grouping → save locally → review the session → see it on the dashboard.
Everything works with no network and no backend.

| Area | State |
| --- | --- |
| Scoring geometry (circle / ellipse / rectangle / polygon, rotation) | Done, 26 tests |
| Grouping, accuracy offset, heat-map grid | Done |
| Local store, WatermelonDB models, bundled presets | Done |
| Dashboard, new session, marking, session detail | Done |
| Sync client | Written, untested against a live server |
| Auth (Cognito), photo upload to S3, target builder, gear management | Not started |

## Layout

```
src/
├── scoring/      geometry.ts, scoring.ts, grouping.ts  — pure, no React, no db
├── analytics/    dashboard.ts                          — pure aggregation
├── db/           schema, models, actions, presets, sync, bootstrap
├── components/   TargetFace, TrendChart, StatTile
├── screens/      Dashboard, NewSession, Marking, SessionDetail
└── hooks/        useDashboardData
```

`scoring/` and `analytics/` are deliberately free of React and of the database.
They are the parts most worth testing and the parts most likely to be reused by
the CV work in Phase 2, and neither needs a component tree to run.

## Conventions that are load-bearing

**Client-generated UUIDs.** `src/db/index.ts` replaces WatermelonDB's default id
generator with `expo-crypto`'s `randomUUID`. Watermelon's built-in generator
makes short random strings, but the server's primary keys are UUIDs, and the
whole offline story rests on the device minting ids the server accepts
unchanged. Remove that line and every record created offline is rejected on
push.

**Normalized 0–1 coordinates everywhere.** Arrow positions and zone geometry are
fractions of the target face. Exactly one place converts a pixel into a
normalized coordinate — the tap handler in `TargetFace` — so there is one place
for that conversion to be wrong rather than several.

**Derived values are never stored.** Grouping, averages, heat maps and personal
bests are computed on read. The single exception is `arrows.score_value`,
resolved at mark time so a score survives a later edit to a custom target.

**Deletes use `markAsDeleted`, never `destroyPermanently`.** Watermelon keeps a
local tombstone so the next push can tell the server the row is gone. Destroying
outright removes it here and leaves it alive on every other device.

## Two things found while building this

**Line cutters need a tolerance.** An arrow whose centre sits exactly on a
scoring line takes the higher value. In floating point that rule silently fails:
on the WA 10 ring, r = 0.05 and a mark at x = 0.55 computes a squared distance of
0.0025000000000000044 against r² of 0.0025000000000000005, and scores a 9.
`geometry.ts` carries a 1e-9 epsilon for this — well below both the stored
6-decimal precision and any physically meaningful distance. The SQL scoring
helper in the seed does not have it, so a boundary arrow can differ by one point
between the two. It only affects seeded data, since real scoring happens here.

**Grouping on a 3-spot needs the aim points.** Measuring spread about a single
centroid on a multi-spot face describes the layout of the target, not the
archer: it returns roughly a third of the face height however well they shot.
`groupSpreadMultiSpot` translates each mark into the frame of its nearest aim
point and measures the pooled cloud. The obvious alternative — cluster per spot
and average — fails on the standard indoor round, where exactly one arrow goes
in each face, every cluster holds a single point, and the archer gets no
grouping figure at all.

## Known gaps

- The sync client is written against the API contract but has never run against
  a live server. `/sync/pull` also cannot report deletions yet — see the writeup
  in [`backend/db/README.md`](../db/README.md).
- `targets.aspect_ratio` exists locally but not in the Postgres schema. Non-square
  faces need it to score a photo correctly; it is currently sourced from the
  bundled presets.
- Auth is absent. `runSync` expects a token provider; nothing supplies one yet.
